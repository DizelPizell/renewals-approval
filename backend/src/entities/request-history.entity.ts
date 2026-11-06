import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('request_history')
export class RequestHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id' })
  requestId: string;

  @Column({ name: 'actor_id' })
  actorId: string;

  @Column({ name: 'from_status', type: 'varchar', length: 50, nullable: true })
  fromStatus: string;

  @Column({ name: 'to_status', type: 'varchar', length: 50 })
  toStatus: string;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
