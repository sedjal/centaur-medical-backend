import knex, { Knex } from 'knex';

let instance: Knex | null = null;
/** Test-only override — never use in production code paths. */
let testOverride: Knex | null = null;

export function __setTestDb(db: Knex | null): void {
  testOverride = db;
}

export function createDb(config?: {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}): Knex {
  if (instance) return instance;
  instance = knex({
    client: 'pg',
    connection: {
      host: config?.host || process.env.DB_HOST || '127.0.0.1',
      port: config?.port || Number(process.env.DB_PORT || 5432),
      user: config?.user || process.env.DB_USER || 'postgres',
      password: config?.password || process.env.DB_PASSWORD || 'postgres',
      database: config?.database || process.env.DB_NAME || 'centaur_medical',
    },
    pool: { min: 0, max: 10 },
  });
  return instance;
}

export function getDb(): Knex {
  if (testOverride) return testOverride;
  if (!instance) return createDb();
  return instance;
}

export async function destroyDb(): Promise<void> {
  testOverride = null;
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}
