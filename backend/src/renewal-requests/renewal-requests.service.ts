import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RenewalRequest, RequestStatus } from '../entities/renewal-request.entity';
import { RequestHistory } from '../entities/request-history.entity';
import { Resource } from '../entities/resource.entity';
import { User } from '../entities/user.entity';
import { CreateRequestDto } from './dto/create-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';

function toDateStr(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val.substring(0, 10);
  return new Date(val).toISOString().substring(0, 10);
}

@Injectable()
export class RenewalRequestsService {
  constructor(
    @InjectRepository(RenewalRequest)
    private requestRepo: Repository<RenewalRequest>,
    @InjectRepository(Resource)
    private resourceRepo: Repository<Resource>,
    @InjectRepository(RequestHistory)
    private historyRepo: Repository<RequestHistory>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async findAll(user: User) {
    return this.requestRepo.find({
      where: { workspaceId: user.workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: User) {
    const req = await this.requestRepo.findOne({ where: { id } });
    if (!req || req.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Request not found or access denied');
    }
    return req;
  }

  async create(dto: CreateRequestDto, user: User) {
    if (!user.roles.includes('create')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const resource = await this.resourceRepo.findOne({ where: { id: dto.resourceId } });
    if (!resource || resource.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Resource not found or access denied');
    }

    const oldDate = toDateStr(resource.expiryDate);
    const [y, m, day] = oldDate.split('-').map(Number);
    const newDate = new Date(Date.UTC(y, m - 1, day + 30)).toISOString().substring(0, 10);

    const idempotencyKey = uuidv4();

    try {
      const saved = await this.requestRepo.save(
        this.requestRepo.create({
          resourceId: dto.resourceId,
          workspaceId: user.workspaceId,
          createdById: user.id,
          status: RequestStatus.PENDING,
          oldDate,
          newDate,
          amountMinor: resource.amountMinor,
          currency: resource.currency,
          idempotencyKey,
        }),
      );

      await this.historyRepo.save({
        requestId: saved.id,
        actorId: user.id,
        fromStatus: null,
        toStatus: RequestStatus.PENDING,
        comment: 'Заявка создана',
      });

      return saved;
    } catch (err) {
      if (err?.code === '23505') {
        throw new ConflictException('Active renewal request already exists for this resource');
      }
      throw err;
    }
  }

  async approve(id: string, user: User) {
    if (!user.roles.includes('approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const rows = await qr.query(
        `SELECT * FROM renewal_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (rows.length === 0) throw new ForbiddenException('Request not found or access denied');
      const req = rows[0];

      if (req.workspace_id !== user.workspaceId) throw new ForbiddenException('Access denied');
      if (req.created_by_id === user.id) throw new ForbiddenException('Cannot approve your own request');
      if (req.status !== 'PENDING') throw new ConflictException(`Cannot approve request in ${req.status} state`);

      // Snapshot check
      const [resource] = await qr.query(`SELECT * FROM resources WHERE id = $1`, [req.resource_id]);
      if (
        toDateStr(resource.expiry_date) !== toDateStr(req.old_date) ||
        resource.amount_minor.toString() !== req.amount_minor.toString()
      ) {
        throw new ConflictException('Resource data has changed since request creation');
      }

      const updateResult = await qr.query(
        `UPDATE renewal_requests SET status = 'PROCESSING', approved_by_id = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'PENDING'`,
        [user.id, id],
      );
      if (updateResult[1] === 0) throw new ConflictException('Request was already processed');

      await qr.query(
        `INSERT INTO outbox_jobs
           (id, request_id, idempotency_key, resource_id, amount_minor, currency,
            status, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PENDING', 0, NOW(), NOW(), NOW())
         ON CONFLICT (request_id) DO NOTHING`,
        [id, req.idempotency_key, req.resource_id, req.amount_minor, req.currency],
      );

      await qr.query(
        `INSERT INTO request_history (id, request_id, actor_id, from_status, to_status, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'PENDING', 'PROCESSING', NOW())`,
        [id, user.id],
      );

      await qr.commitTransaction();
      return this.requestRepo.findOne({ where: { id } });
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async reject(id: string, dto: RejectRequestDto, user: User) {
    if (!user.roles.includes('approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const rows = await qr.query(
        `SELECT * FROM renewal_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (rows.length === 0) throw new ForbiddenException('Request not found or access denied');
      const req = rows[0];

      if (req.workspace_id !== user.workspaceId) throw new ForbiddenException('Access denied');
      if (req.created_by_id === user.id) throw new ForbiddenException('Cannot reject your own request');
      if (req.status !== 'PENDING') throw new ConflictException(`Cannot reject request in ${req.status} state`);

      await qr.query(
        `UPDATE renewal_requests SET status = 'REJECTED', rejected_by_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [user.id, id],
      );

      await qr.query(
        `INSERT INTO request_history (id, request_id, actor_id, from_status, to_status, comment, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'PENDING', 'REJECTED', $3, NOW())`,
        [id, user.id, dto?.comment || null],
      );

      await qr.commitTransaction();
      return this.requestRepo.findOne({ where: { id } });
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async retry(id: string, user: User) {
    if (!user.roles.includes('approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const rows = await qr.query(
        `SELECT * FROM renewal_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (rows.length === 0) throw new ForbiddenException('Request not found or access denied');
      const req = rows[0];

      if (req.workspace_id !== user.workspaceId) throw new ForbiddenException('Access denied');
      if (req.created_by_id === user.id) throw new ForbiddenException('Cannot retry your own request');
      if (req.status !== 'NEEDS_ATTENTION') {
        throw new ConflictException(`Cannot retry request in ${req.status} state`);
      }

      await qr.query(
        `UPDATE renewal_requests SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1`,
        [id],
      );

      await qr.query(
        `UPDATE outbox_jobs
         SET status = 'PENDING', attempt_count = 0, next_attempt_at = NOW(),
             lease_until = NULL, updated_at = NOW()
         WHERE request_id = $1`,
        [id],
      );

      await qr.query(
        `INSERT INTO request_history (id, request_id, actor_id, from_status, to_status, comment, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'NEEDS_ATTENTION', 'PROCESSING', 'Повтор по запросу согласующего', NOW())`,
        [id, user.id],
      );

      await qr.commitTransaction();
      return this.requestRepo.findOne({ where: { id } });
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async getHistory(id: string, user: User) {
    const req = await this.requestRepo.findOne({ where: { id } });
    if (!req || req.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Request not found or access denied');
    }
    const rows = await this.dataSource.query(
      `SELECT rh.id, rh.request_id, rh.actor_id,
              u.username AS actor_username,
              rh.from_status, rh.to_status, rh.comment, rh.created_at
       FROM request_history rh
       LEFT JOIN users u ON u.id = rh.actor_id
       WHERE rh.request_id = $1
       ORDER BY rh.created_at ASC`,
      [id],
    );
    return rows.map((r: any) => ({
      id: r.id,
      requestId: r.request_id,
      actorId: r.actor_id,
      actorUsername: r.actor_username ?? null,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  async getStats(resourceId: string, user: User) {
    const resource = await this.resourceRepo.findOne({ where: { id: resourceId } });
    if (!resource || resource.workspaceId !== user.workspaceId) {
      return { operation_count: 0 };
    }
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int as count FROM renewal_requests
       WHERE resource_id = $1 AND status = 'COMPLETED'`,
      [resourceId],
    );
    return { operation_count: count };
  }
}
