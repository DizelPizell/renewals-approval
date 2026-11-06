import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'workspace_id' })
  workspaceId: string;

  @Column('text', { array: true, default: '{}' })
  roles: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
