import { AppDataSource } from '../data-source';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

const USERS = [
  { username: 'initiator-alpha', workspace: 'alpha', roles: ['create'] },
  { username: 'approver-alpha', workspace: 'alpha', roles: ['approve'] },
  { username: 'initiator-beta', workspace: 'beta', roles: ['create'] },
  { username: 'universal-alpha', workspace: 'alpha', roles: ['create', 'approve'] },
];

const RESOURCES = [
  { id: 'res-a-01', name: 'Хранилище A', workspace: 'alpha', expiryDate: '2027-03-01', amount: 128000 },
  { id: 'res-a-02', name: 'Сервис B', workspace: 'alpha', expiryDate: '2027-05-20', amount: 250000 },
  { id: 'res-b-01', name: 'Сервис C', workspace: 'beta', expiryDate: '2027-06-01', amount: 150000 },
];

async function seed() {
  await AppDataSource.initialize();

  for (const user of USERS) {
    const passwordHash = await bcrypt.hash(user.username, SALT_ROUNDS);
    await AppDataSource.query(
      `INSERT INTO users (username, password_hash, workspace_id, roles)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             workspace_id = EXCLUDED.workspace_id,
             roles = EXCLUDED.roles`,
      [user.username, passwordHash, user.workspace, user.roles],
    );
  }
  console.log('Users seeded');

  for (const r of RESOURCES) {
    await AppDataSource.query(
      `INSERT INTO resources (id, name, workspace_id, expiry_date, amount_minor, currency)
       VALUES ($1, $2, $3, $4, $5, 'RUB')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             expiry_date = EXCLUDED.expiry_date,
             amount_minor = EXCLUDED.amount_minor`,
      [r.id, r.name, r.workspace, r.expiryDate, r.amount],
    );
  }
  console.log('Resources seeded');

  await AppDataSource.destroy();
  console.log('Seed complete');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
