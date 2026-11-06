import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

@Entity('outbox_jobs')
export class OutboxJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', unique: true })
  requestId: string;

  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey: string;

  @Column({ name: 'resource_id' })
  resourceId: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Column()
  currency: string;

  @Column({ type: 'varchar', length: 50, default: JobStatus.PENDING })
  status: JobStatus;

  @Column({ name: 'attempt_count', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil: Date;

  @Column({ name: 'provider_result', type: 'jsonb', nullable: true })
  providerResult: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
