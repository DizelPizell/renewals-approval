import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryActorNullable1700000000001 implements MigrationInterface {
  name = 'HistoryActorNullable1700000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Allow NULL actor_id for system/worker-generated transitions
    await queryRunner.query(`
      ALTER TABLE request_history
        DROP CONSTRAINT IF EXISTS request_history_actor_id_fkey,
        ALTER COLUMN actor_id DROP NOT NULL,
        ALTER COLUMN actor_id TYPE UUID USING actor_id::uuid
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE request_history
        ALTER COLUMN actor_id SET NOT NULL,
        ADD CONSTRAINT request_history_actor_id_fkey
          FOREIGN KEY (actor_id) REFERENCES users(id)
    `);
  }
}
