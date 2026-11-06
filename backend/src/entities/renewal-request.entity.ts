import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum RequestStatus {
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  NEEDS_ATTENTION = 'NEEDS_ATTENTION',
}

@Entity('renewal_requests')
export class RenewalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_id' })
  resourceId: string;

  @Column({ name: 'workspace_id' })
  workspaceId: string;

  @Column({ name: 'created_by_id' })
  createdById: string;

  @Column({ type: 'varchar', length: 50, default: RequestStatus.PENDING })
  status: RequestStatus;

  @Column({ name: 'old_date', type: 'date' })
  oldDate: string;

  @Column({ name: 'new_date', type: 'date' })
  newDate: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Column()
  currency: string;

  @Column({ name: 'idempotency_key', type: 'uuid', unique: true })
  idempotencyKey: string;

  @Column({ name: 'approved_by_id', nullable: true })
  approvedById: string;

  @Column({ name: 'rejected_by_id', nullable: true })
  rejectedById: string;

  @Column({ name: 'provider_operation_id', nullable: true })
  providerOperationId: string;

  @Column({ name: 'provider_result', type: 'jsonb', nullable: true })
  providerResult: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
