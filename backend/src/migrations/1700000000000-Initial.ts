import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1700000000000 implements MigrationInterface {
  name = 'Initial1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR NOT NULL UNIQUE,
        password_hash VARCHAR NOT NULL,
        workspace_id VARCHAR NOT NULL,
        roles TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE resources (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        workspace_id VARCHAR NOT NULL,
        expiry_date DATE NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR NOT NULL DEFAULT 'RUB',
        version INT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE renewal_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id VARCHAR NOT NULL REFERENCES resources(id),
        workspace_id VARCHAR NOT NULL,
        created_by_id UUID NOT NULL REFERENCES users(id),
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        old_date DATE NOT NULL,
        new_date DATE NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR NOT NULL,
        idempotency_key UUID NOT NULL UNIQUE,
        approved_by_id UUID REFERENCES users(id),
        rejected_by_id UUID REFERENCES users(id),
        provider_operation_id VARCHAR,
        provider_result JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_one_active_request
      ON renewal_requests(resource_id)
      WHERE status IN ('PENDING', 'PROCESSING', 'NEEDS_ATTENTION')
    `);

    await queryRunner.query(`
      CREATE TABLE request_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL REFERENCES renewal_requests(id),
        actor_id UUID NOT NULL REFERENCES users(id),
        from_status VARCHAR(50),
        to_status VARCHAR(50) NOT NULL,
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE outbox_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL UNIQUE REFERENCES renewal_requests(id),
        idempotency_key UUID NOT NULL,
        resource_id VARCHAR NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        attempt_count INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lease_until TIMESTAMPTZ,
        provider_result JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS outbox_jobs CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS request_history CASCADE');
    await queryRunner.query('DROP INDEX IF EXISTS idx_one_active_request');
    await queryRunner.query('DROP TABLE IF EXISTS renewal_requests CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS resources CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS users CASCADE');
  }
}
