import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryActorFKRestore1700000000002 implements MigrationInterface {
  name = 'HistoryActorFKRestore1700000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Restore FK while keeping actor_id nullable (NULL = system/worker transition)
    await queryRunner.query(`
      ALTER TABLE request_history
        ADD CONSTRAINT request_history_actor_id_fkey
          FOREIGN KEY (actor_id) REFERENCES users(id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE request_history
        DROP CONSTRAINT IF EXISTS request_history_actor_id_fkey
    `);
  }
}
