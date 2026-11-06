import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('resources')
export class Resource {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ name: 'workspace_id' })
  workspaceId: string;

  @Column({ name: 'expiry_date', type: 'date' })
  expiryDate: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Column({ default: 'RUB' })
  currency: string;

  @Column({ default: 1 })
  version: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
