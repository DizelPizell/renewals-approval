import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ProviderService } from '../provider/provider.service';

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private pollTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private config: ConfigService,
    private provider: ProviderService,
  ) {}

  onModuleInit() {
    const ms = parseInt(this.config.get('WORKER_POLL_INTERVAL_MS', '2000'));
    this.pollTimer = setInterval(() => this.tick(), ms);
    console.log(`[worker] started, poll interval ${ms}ms`);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.claimAndProcess();
    } catch (err) {
      console.error('[worker] tick error:', err.message);
    } finally {
      this.busy = false;
    }
  }

  private async claimAndProcess() {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let job: any = null;
    try {
      const rows = await qr.query(`
        SELECT * FROM outbox_jobs
        WHERE (status = 'PENDING' AND next_attempt_at <= NOW())
           OR (status = 'PROCESSING' AND lease_until < NOW())
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);

      if (!rows.length) {
        await qr.rollbackTransaction();
        return;
      }

      job = rows[0];

      await qr.query(
        `UPDATE outbox_jobs
         SET status = 'PROCESSING',
             lease_until = NOW() + INTERVAL '60 seconds',
             updated_at = NOW()
         WHERE id = $1`,
        [job.id],
      );

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    if (job) await this.processJob(job);
  }

  private async processJob(job: any) {
    const retryDelay = parseInt(this.config.get('PROVIDER_RETRY_DELAY_MS', '5000'));

    // Check GET first if we had previous failed POSTs
    if (job.attempt_count > 0) {
      const got = await this.safeGet(job.idempotency_key);
      if (got?.status === 'completed') {
        await this.completeJob(job, got);
        return;
      }
    }

    // POST to provider
    const postResult = await this.safePost(job);
    if (postResult?.status === 'completed') {
      await this.completeJob(job, postResult);
      return;
    }

    // POST failed — persist attempt count immediately (crash-safe)
    const attempts = job.attempt_count + 1;
    await this.dataSource.query(
      `UPDATE outbox_jobs SET attempt_count = $1, updated_at = NOW() WHERE id = $2`,
      [attempts, job.id],
    );

    // Wait and check GET
    await this.sleep(retryDelay);

    const got = await this.safeGet(job.idempotency_key);
    if (got?.status === 'completed') {
      await this.completeJob(job, got);
      return;
    }

    if (attempts >= 3) {
      await this.failJob(job.id, job.request_id, attempts);
    } else {
      // Release for next poll cycle
      await this.dataSource.query(
        `UPDATE outbox_jobs
         SET status = 'PENDING', lease_until = NULL,
             next_attempt_at = NOW() + make_interval(secs => $1 / 1000.0),
             updated_at = NOW()
         WHERE id = $2`,
        [retryDelay, job.id],
      );
    }
  }

  private async safePost(job: any): Promise<any> {
    try {
      return await this.provider.createRenewal({
        idempotencyKey: job.idempotency_key,
        resourceId: job.resource_id,
        amountMinor: parseInt(job.amount_minor),
        currency: job.currency,
      });
    } catch {
      return null;
    }
  }

  private async safeGet(key: string): Promise<any> {
    try {
      return await this.provider.getOperation(key);
    } catch {
      return null;
    }
  }

  private async completeJob(job: any, providerResult: any) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `UPDATE outbox_jobs
         SET status = 'DONE', provider_result = $1, lease_until = NULL, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(providerResult), job.id],
      );

      // Transition to COMPLETED only if still PROCESSING (idempotent)
      const updated = await qr.query(
        `UPDATE renewal_requests
         SET status = 'COMPLETED',
             provider_operation_id = $1,
             provider_result = $2,
             updated_at = NOW()
         WHERE id = $3 AND status = 'PROCESSING'
         RETURNING resource_id, new_date`,
        [
          providerResult?.operation_id || null,
          JSON.stringify(providerResult),
          job.request_id,
        ],
      );

      if (updated[0]?.length > 0) {
        const { resource_id, new_date } = updated[0][0];
        await qr.query(
          `UPDATE resources SET expiry_date = $1, updated_at = NOW() WHERE id = $2`,
          [new_date, resource_id],
        );

        await qr.query(
          `INSERT INTO request_history
             (id, request_id, actor_id, from_status, to_status, created_at)
           SELECT gen_random_uuid(), $1, created_by_id, 'PROCESSING', 'COMPLETED', NOW()
           FROM renewal_requests WHERE id = $1`,
          [job.request_id],
        );
      }

      await qr.commitTransaction();
      console.log(`[worker] job ${job.id} → COMPLETED`);
    } catch (err) {
      await qr.rollbackTransaction();
      console.error('[worker] completeJob error:', err.message);
    } finally {
      await qr.release();
    }
  }

  private async failJob(jobId: string, requestId: string, attempts: number) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(
        `UPDATE outbox_jobs
         SET status = 'FAILED', attempt_count = $1, lease_until = NULL, updated_at = NOW()
         WHERE id = $2`,
        [attempts, jobId],
      );

      await qr.query(
        `UPDATE renewal_requests SET status = 'NEEDS_ATTENTION', updated_at = NOW() WHERE id = $1`,
        [requestId],
      );

      await qr.query(
        `INSERT INTO request_history
           (id, request_id, actor_id, from_status, to_status, comment, created_at)
         SELECT gen_random_uuid(), $1, created_by_id,
                'PROCESSING', 'NEEDS_ATTENTION',
                'Provider unreachable after 3 attempts', NOW()
         FROM renewal_requests WHERE id = $1`,
        [requestId],
      );

      await qr.commitTransaction();
      console.log(`[worker] job ${jobId} → NEEDS_ATTENTION after ${attempts} attempts`);
    } catch (err) {
      await qr.rollbackTransaction();
      console.error('[worker] failJob error:', err.message);
    } finally {
      await qr.release();
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }
}
