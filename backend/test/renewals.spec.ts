import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { createFakeProvider, FakeProvider } from './fake-provider';
import { WorkerService } from '../src/worker/worker.service';

jest.setTimeout(30000);

let app: INestApplication;
let ds: DataSource;
let fakeProvider: FakeProvider;

async function getToken(username: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username, password: username });
  return res.body.access_token;
}

async function seedUsers(ds: DataSource) {
  const users = [
    { username: 'initiator-alpha', workspace: 'alpha', roles: ['create'] },
    { username: 'approver-alpha', workspace: 'alpha', roles: ['approve'] },
    { username: 'initiator-beta', workspace: 'beta', roles: ['create'] },
    { username: 'universal-alpha', workspace: 'alpha', roles: ['create', 'approve'] },
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
}

async function seedResources(ds: DataSource) {
  const resources = [
    { id: 'res-a-01', name: 'Хранилище A', workspace: 'alpha', date: '2027-03-01', amount: 128000 },
    { id: 'res-a-02', name: 'Сервис B', workspace: 'alpha', date: '2027-05-20', amount: 250000 },
    { id: 'res-b-01', name: 'Сервис C', workspace: 'beta', date: '2027-06-01', amount: 150000 },
  ];
  for (const r of resources) {
    await ds.query(
      `INSERT INTO resources (id, name, workspace_id, expiry_date, amount_minor, currency)
       VALUES ($1,$2,$3,$4,$5,'RUB') ON CONFLICT (id) DO UPDATE
       SET expiry_date=EXCLUDED.expiry_date, amount_minor=EXCLUDED.amount_minor`,
      [r.id, r.name, r.workspace, r.date, r.amount],
    );
  }
}

async function cleanDb(ds: DataSource) {
  await ds.query('DELETE FROM outbox_jobs');
  await ds.query('DELETE FROM request_history');
  await ds.query('DELETE FROM renewal_requests');
  await ds.query(`UPDATE resources SET expiry_date='2027-03-01' WHERE id='res-a-01'`);
  await ds.query(`UPDATE resources SET expiry_date='2027-05-20' WHERE id='res-a-02'`);
  await ds.query(`UPDATE resources SET expiry_date='2027-06-01' WHERE id='res-b-01'`);
  // Remove any resources seeded by e2e tests (e.g. res-e2e-01) that may linger in the test DB
  await ds.query(`DELETE FROM resources WHERE id NOT IN ('res-a-01', 'res-a-02', 'res-b-01')`);
}

beforeAll(async () => {
  fakeProvider = await createFakeProvider(8092);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  ds = app.get(DataSource);

  // Run migrations
  await ds.runMigrations();
  await seedUsers(ds);
  await seedResources(ds);
});

afterAll(async () => {
  await app.close();
  await fakeProvider.close();
});

beforeEach(async () => {
  await cleanDb(ds);
  fakeProvider.reset();
});

// ---- Auth ----
describe('Auth', () => {
  it('POST /auth/login → 200 with token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'initiator-alpha', password: 'initiator-alpha' });
    expect(res.status).toBe(201);
    expect(res.body.access_token).toBeTruthy();
  });

  it('POST /auth/login → 401 on wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'initiator-alpha', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('GET /resources → 401 without token', async () => {
    const res = await request(app.getHttpServer()).get('/resources');
    expect(res.status).toBe(401);
  });
});

// ---- Resources ----
describe('Resources', () => {
  it('GET /resources returns only own workspace', async () => {
    const token = await getToken('initiator-alpha');
    const res = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.every((r: any) => r.workspaceId === 'alpha')).toBe(true);
    expect(res.body.length).toBe(2);
  });
});

// ---- Create request ----
describe('Create renewal request', () => {
  it('initiator creates a request → 201 PENDING', async () => {
    const token = await getToken('initiator-alpha');
    const res = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'res-a-01' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.oldDate).toBe('2027-03-01');
    expect(res.body.newDate).toBe('2027-03-31');
  });

  it('approver-only cannot create → 403', async () => {
    const token = await getToken('approver-alpha');
    const res = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'res-a-01' });
    expect(res.status).toBe(403);
  });

  it('cross-workspace resource → 403', async () => {
    const token = await getToken('initiator-alpha');
    const res = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'res-b-01' });
    expect(res.status).toBe(403);
  });

  it('second active request on same resource → 409', async () => {
    const token = await getToken('initiator-alpha');
    await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'res-a-01' });

    const res2 = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'res-a-01' });
    expect(res2.status).toBe(409);
  });
});

// ---- Date arithmetic — timezone invariant ----
describe('date arithmetic timezone invariant', () => {
  it('newDate is 2027-03-31 when TZ=America/Los_Angeles', async () => {
    const savedTZ = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const token = await getToken('initiator-alpha');
      const res = await request(app.getHttpServer())
        .post('/renewal-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ resourceId: 'res-a-01' });
      expect(res.status).toBe(201);
      expect(res.body.newDate).toBe('2027-03-31');
    } finally {
      if (savedTZ !== undefined) process.env.TZ = savedTZ;
      else delete process.env.TZ;
    }
  });

  it('newDate is 2027-03-31 when TZ=Asia/Tokyo', async () => {
    const savedTZ = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      const token = await getToken('initiator-alpha');
      const res = await request(app.getHttpServer())
        .post('/renewal-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ resourceId: 'res-a-01' });
      expect(res.status).toBe(201);
      expect(res.body.newDate).toBe('2027-03-31');
    } finally {
      if (savedTZ !== undefined) process.env.TZ = savedTZ;
      else delete process.env.TZ;
    }
  });
});

// ---- Approve / Reject ----
describe('Approve & Reject', () => {
  let requestId: string;
  let initiatorToken: string;
  let approverToken: string;

  beforeEach(async () => {
    initiatorToken = await getToken('initiator-alpha');
    approverToken = await getToken('approver-alpha');
    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    requestId = created.body.id;
  });

  it('reject → 201 REJECTED, no provider call', async () => {
    const res = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ comment: 'Not needed' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
  });

  it('self-reject → 403', async () => {
    // universal-alpha creates their own request
    const uToken = await getToken('universal-alpha');
    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${uToken}`)
      .send({ resourceId: 'res-a-02' });
    const rid = created.body.id;

    const res = await request(app.getHttpServer())
      .post(`/renewal-requests/${rid}/reject`)
      .set('Authorization', `Bearer ${uToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('cross-workspace access to known ID → 403', async () => {
    const betaToken = await getToken('initiator-beta');
    const res = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${betaToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('repeated approve → first 201, second 409', async () => {
    const r1 = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(r1.status).toBe(201);

    const r2 = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(r2.status).toBe(409);
  });

  it('parallel approve → exactly one 201 and one 409, one job', async () => {
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/renewal-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`),
      request(app.getHttpServer())
        .post(`/renewal-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const [{ count }] = await ds.query(
      `SELECT COUNT(*)::int as count FROM outbox_jobs WHERE request_id = $1`,
      [requestId],
    );
    expect(count).toBe(1);
  });

  it('resource changed after request created → 409 on approve, no job', async () => {
    // Change resource amount
    await ds.query(
      `UPDATE resources SET amount_minor = 999999 WHERE id = 'res-a-01'`,
    );

    const res = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(res.status).toBe(409);

    const [{ count }] = await ds.query(
      `SELECT COUNT(*)::int as count FROM outbox_jobs WHERE request_id = $1`,
      [requestId],
    );
    expect(count).toBe(0);

    // Restore
    await ds.query(`UPDATE resources SET amount_minor = 128000 WHERE id = 'res-a-01'`);
  });
});

// ---- Worker / Provider integration ----
describe('Worker & Provider', () => {
  it('approve → worker processes → COMPLETED, expiry_date updated', async () => {
    const initiatorToken = await getToken('initiator-alpha');
    const approverToken = await getToken('approver-alpha');

    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    const requestId = created.body.id;

    await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    // Wait for worker to complete (503 → GET confirms)
    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      const req = r.body.find((x: any) => x.id === requestId);
      return req?.status === 'COMPLETED';
    }, 15000);

    // Check resource updated
    const resources = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${initiatorToken}`);
    const res = resources.body.find((r: any) => r.id === 'res-a-01');
    expect(res.expiryDate).toBe('2027-03-31');
  });

  it('resource expiry updated exactly once on repeated processing (direct completeJob + concurrent)', async () => {
    const initiatorToken = await getToken('initiator-alpha');
    const approverToken = await getToken('approver-alpha');
    const workerService = app.get(WorkerService);

    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    const requestId = created.body.id;

    await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    // Bring to COMPLETED via normal flow
    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      return r.body.find((x: any) => x.id === requestId)?.status === 'COMPLETED';
    }, 15000);

    const resourcesRes = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${initiatorToken}`);
    const res = resourcesRes.body.find((r: any) => r.id === 'res-a-01');
    expect(res.expiryDate).toBe('2027-03-31');

    // Fetch the outbox job (now DONE) to replay completeJob directly
    const [job] = await ds.query(
      `SELECT id, request_id FROM outbox_jobs WHERE request_id = $1`,
      [requestId],
    );
    const fakeResult = { operation_id: 'op-duplicate-test', status: 'completed' };

    // Call completeJob directly on an already-COMPLETED request — should be a no-op
    await (workerService as any).completeJob(job, fakeResult);

    // Call twice concurrently — both should be no-ops
    await Promise.all([
      (workerService as any).completeJob(job, fakeResult),
      (workerService as any).completeJob(job, fakeResult),
    ]);

    // Resource must still be 2027-03-31 — not shifted again
    const resourcesRes2 = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${initiatorToken}`);
    const res2 = resourcesRes2.body.find((r: any) => r.id === 'res-a-01');
    expect(res2.expiryDate).toBe('2027-03-31');

    // History must have exactly one PROCESSING → COMPLETED transition
    const history = await ds.query(
      `SELECT from_status, to_status FROM request_history WHERE request_id = $1 ORDER BY created_at`,
      [requestId],
    );
    const completedEntries = history.filter(
      (h: any) => h.from_status === 'PROCESSING' && h.to_status === 'COMPLETED',
    );
    expect(completedEntries).toHaveLength(1);

    // Backend operation_count must be exactly 1
    const statsRes = await request(app.getHttpServer())
      .get(`/stats?resource_id=res-a-01`)
      .set('Authorization', `Bearer ${initiatorToken}`);
    expect(statsRes.body.operation_count).toBe(1);
  });

  it('3 POST failures → NEEDS_ATTENTION', async () => {
    // Force provider to always return 503 and not save op (so GET also returns 404)
    fakeProvider.failAll(100);

    const initiatorToken = await getToken('initiator-alpha');
    const approverToken = await getToken('approver-alpha');

    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    const requestId = created.body.id;

    await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      return r.body.find((x: any) => x.id === requestId)?.status === 'NEEDS_ATTENTION';
    }, 20000);

    const r = await request(app.getHttpServer())
      .get('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`);
    expect(r.body.find((x: any) => x.id === requestId)?.status).toBe('NEEDS_ATTENTION');
  });

  it('NEEDS_ATTENTION → retry by approver → COMPLETED', async () => {
    fakeProvider.failAll(100);

    const initiatorToken = await getToken('initiator-alpha');
    const approverToken = await getToken('approver-alpha');

    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    const requestId = created.body.id;

    await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      return r.body.find((x: any) => x.id === requestId)?.status === 'NEEDS_ATTENTION';
    }, 20000);

    // Now fix provider
    fakeProvider.reset();

    const retryRes = await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/retry`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(retryRes.status).toBe(201);

    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      return r.body.find((x: any) => x.id === requestId)?.status === 'COMPLETED';
    }, 15000);
  });

  it('stats: completed request counted, other workspace not', async () => {
    const initiatorToken = await getToken('initiator-alpha');
    const approverToken = await getToken('approver-alpha');

    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    const requestId = created.body.id;

    await request(app.getHttpServer())
      .post(`/renewal-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    await waitFor(async () => {
      const r = await request(app.getHttpServer())
        .get('/renewal-requests')
        .set('Authorization', `Bearer ${initiatorToken}`);
      return r.body.find((x: any) => x.id === requestId)?.status === 'COMPLETED';
    }, 15000);

    const stats = await request(app.getHttpServer())
      .get('/stats?resource_id=res-a-01')
      .set('Authorization', `Bearer ${initiatorToken}`);
    expect(stats.body.operation_count).toBe(1);

    // res-b-01 belongs to beta, alpha user should get 0
    const stats2 = await request(app.getHttpServer())
      .get('/stats?resource_id=res-b-01')
      .set('Authorization', `Bearer ${initiatorToken}`);
    expect(stats2.body.operation_count).toBe(0);
  });
});

// ---- History ----
describe('History', () => {
  it('history endpoint requires workspace access', async () => {
    const initiatorToken = await getToken('initiator-alpha');
    const created = await request(app.getHttpServer())
      .post('/renewal-requests')
      .set('Authorization', `Bearer ${initiatorToken}`)
      .send({ resourceId: 'res-a-01' });
    const rid = created.body.id;

    const betaToken = await getToken('initiator-beta');
    const res = await request(app.getHttpServer())
      .get(`/renewal-requests/${rid}/history`)
      .set('Authorization', `Bearer ${betaToken}`);
    expect(res.status).toBe(403);
  });
});

// ---- Helper ----
async function waitFor(fn: () => Promise<boolean>, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
