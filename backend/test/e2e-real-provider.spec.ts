/**
 * E2E test against the REAL provider simulator (python provider_simulator.py).
 *
 * Prerequisites:
 *   1. PostgreSQL running on DB_PORT (default 5433) with renewals_test DB migrated.
 *   2. Provider simulator running: `python3 provider/provider_simulator.py`
 *      (listens on 127.0.0.1:8091)
 *
 * Run with:  npx jest --testPathPattern e2e-real-provider --runInBand
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
const request = require('supertest');
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

jest.setTimeout(60000);

// Point at real simulator; speed up polling/retries for the test
process.env.PROVIDER_URL = 'http://127.0.0.1:8091';
process.env.PROVIDER_RETRY_DELAY_MS = '1500';
process.env.WORKER_POLL_INTERVAL_MS = '300';

const SIMULATOR_URL = 'http://127.0.0.1:8091';

let app: INestApplication;
let ds: DataSource;

async function checkSimulatorAvailable(): Promise<boolean> {
  try {
    const r = await axios.get(`${SIMULATOR_URL}/health`, { timeout: 2000 });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function seedTestData(ds: DataSource) {
  const users = [
    { username: 'e2e-initiator', workspace: 'alpha', roles: ['create'] },
    { username: 'e2e-approver', workspace: 'alpha', roles: ['approve'] },
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.username, 4);
    await ds.query(
      `INSERT INTO users (username, password_hash, workspace_id, roles)
       VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO UPDATE
       SET password_hash=EXCLUDED.password_hash, roles=EXCLUDED.roles`,
      [u.username, hash, u.workspace, u.roles],
    );
  }
  await ds.query(
    `INSERT INTO resources (id, name, workspace_id, expiry_date, amount_minor, currency)
     VALUES ('res-e2e-01','E2E Resource','alpha','2027-04-01',100000,'RUB')
     ON CONFLICT (id) DO UPDATE SET expiry_date='2027-04-01', amount_minor=100000`,
  );
}

async function cleanE2eData(ds: DataSource) {
  await ds.query(`DELETE FROM outbox_jobs WHERE resource_id = 'res-e2e-01'`);
  await ds.query(
    `DELETE FROM request_history WHERE request_id IN
     (SELECT id FROM renewal_requests WHERE resource_id='res-e2e-01')`,
  );
  await ds.query(`DELETE FROM renewal_requests WHERE resource_id = 'res-e2e-01'`);
  await ds.query(`UPDATE resources SET expiry_date='2027-04-01' WHERE id='res-e2e-01'`);
}

async function getToken(username: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username, password: username });
  expect(res.status).toBe(201);
  return res.body.access_token;
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

beforeAll(async () => {
  const available = await checkSimulatorAvailable();
  if (!available) {
    console.warn(
      '\n⚠  Real provider simulator not running at 127.0.0.1:8091.\n' +
      '   Start it with: python3 provider/provider_simulator.py\n' +
      '   Skipping e2e tests.\n',
    );
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  ds = app.get(DataSource);
  await ds.runMigrations();
  await seedTestData(ds);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await cleanE2eData(ds);
});

describe('E2E against real provider simulator', () => {
  it('simulator health check passes', async () => {
    const available = await checkSimulatorAvailable();
    if (!available) {
      console.warn('Simulator not available, skipping');
      return;
    }
    expect(available).toBe(true);
  });

  it('simulator: first POST → 503 (op saved), second POST → 200, GET → completed', async () => {
    const available = await checkSimulatorAvailable();
    if (!available) return;

    const key = `e2e-test-key-${Date.now()}`;
    const payload = { resource_id: 'res-e2e-01', period_months: 1, amount_minor: 100000, currency: 'RUB' };

    // First POST: 503 (but op is saved)
    const r1 = await axios.post(`${SIMULATOR_URL}/renewals`, payload, {
      headers: { 'Idempotency-Key': key },
      validateStatus: () => true,
    });
    expect(r1.status).toBe(503);
    expect(r1.data.error).toBe('response_lost');

    // GET: op already exists as 'completed'
    const rGet = await axios.get(`${SIMULATOR_URL}/renewals/${encodeURIComponent(key)}`, {
      validateStatus: () => true,
    });
    expect(rGet.status).toBe(200);
    expect(rGet.data.status).toBe('completed');
    expect(rGet.data.resource_id).toBe('res-e2e-01');
    expect(rGet.data.operation_id).toBeTruthy();

    // Second POST with same key: 200
    const r2 = await axios.post(`${SIMULATOR_URL}/renewals`, payload, {
      headers: { 'Idempotency-Key': key },
      validateStatus: () => true,
    });
    expect(r2.status).toBe(200);
    expect(r2.data.status).toBe('completed');
  });

  it('simulator: idempotency conflict on different payload', async () => {
    const available = await checkSimulatorAvailable();
    if (!available) return;

    const key = `e2e-conflict-${Date.now()}`;
    const payload1 = { resource_id: 'res-e2e-01', period_months: 1, amount_minor: 100000, currency: 'RUB' };
    const payload2 = { resource_id: 'res-e2e-01', period_months: 1, amount_minor: 999999, currency: 'RUB' };

    await axios.post(`${SIMULATOR_URL}/renewals`, payload1, {
      headers: { 'Idempotency-Key': key },
      validateStatus: () => true,
    });

    const r2 = await axios.post(`${SIMULATOR_URL}/renewals`, payload2, {
      headers: { 'Idempotency-Key': key },
      validateStatus: () => true,
    });
    expect(r2.status).toBe(409);
    expect(r2.data.error).toBe('idempotency_key_conflict');
  });

  it('full flow: create → approve → worker completes → resource date updated', async () => {
    const available = await checkSimulatorAvailable();
    if (!available) return;

    const initiatorToken = await getToken('e2e-initiator');
    const approverToken = await getToken('e2e-approver');

    // Create request
    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-e2e-01' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.oldDate).toBe('2027-04-01');
    expect(created.body.newDate).toBe('2027-05-01');
    const requestId = created.body.id;
    const idempotencyKey = created.body.idempotencyKey;

    // Approve
    const approved = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('PROCESSING');

    // Wait for worker to call provider (POST → 503, then GET → completed)
    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      return r.body.find((x: any) => x.id === requestId)?.status === 'COMPLETED';
    }, 30000);

    // Verify resource date updated
    const resources = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${initiatorToken}`);
    const res = resources.body.find((r: any) => r.id === 'res-e2e-01');
    expect(res.expiryDate).toBe('2027-05-01');

    // Verify via simulator GET /renewals/{key}
    if (idempotencyKey) {
      const simGet = await axios.get(
        `${SIMULATOR_URL}/renewals/${encodeURIComponent(idempotencyKey)}`,
        { validateStatus: () => true },
      );
      expect(simGet.status).toBe(200);
      expect(simGet.data.status).toBe('completed');
      expect(simGet.data.resource_id).toBe('res-e2e-01');
    }

    // Verify backend stats for this resource
    const stats = await request(app.getHttpServer())
      .get('/stats?resource_id=res-e2e-01')
      .set('Authorization', `Bearer ${initiatorToken}`);
    expect(stats.body.operation_count).toBe(1);

    // Verify simulator stats
    const simStats = await axios.get(
      `${SIMULATOR_URL}/stats?resource_id=res-e2e-01`,
      { validateStatus: () => true },
    );
    expect(simStats.status).toBe(200);
    expect(simStats.data.operation_count).toBeGreaterThanOrEqual(1);
  });
});
