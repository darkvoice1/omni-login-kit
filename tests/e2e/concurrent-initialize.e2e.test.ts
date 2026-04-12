import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Pool } from 'pg';
import { OmniAuth, PostgresStorageAdapter } from '../../src/index.js';
import type { OmniAuthConfig } from '../../src/types/auth-config.js';

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

it('E2E：并发初始化应成功且迁移仅执行一次', async (t) => {
  const baseDatabaseUrl =
    process.env.E2E_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;

  const adminPool = new Pool({ connectionString: baseDatabaseUrl });
  const schemaName = buildSchemaName('omni_auth_e2e_concurrent');
  let auth1: OmniAuth | undefined;
  let auth2: OmniAuth | undefined;

  try {
    try {
      await adminPool.query('SELECT 1');
    } catch (error) {
      t.skip(`skip e2e: cannot connect database (${String(error)})`);
      return;
    }

    if (!/^[a-z0-9_]+$/.test(schemaName)) {
      t.skip('skip e2e: generated schema name is unsafe');
      return;
    }

    try {
      await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    } catch (error) {
      t.skip(`skip e2e: cannot create schema (${String(error)})`);
      return;
    }

    const isolatedDatabaseUrl = withSearchPath(baseDatabaseUrl, schemaName);
    const config = buildPasswordOnlyConfig(isolatedDatabaseUrl);

    auth1 = new OmniAuth({
      config,
      storage: new PostgresStorageAdapter(isolatedDatabaseUrl),
    });
    auth2 = new OmniAuth({
      config,
      storage: new PostgresStorageAdapter(isolatedDatabaseUrl),
    });

    await Promise.all([auth1.initialize(), auth2.initialize()]);

    const migrationRows = await adminPool.query<{ id: string }>(
      `
      SELECT id
      FROM ${schemaName}.omni_auth_schema_migrations
      WHERE id = '0001_init.sql'
      `,
    );
    assert.equal(migrationRows.rowCount, 1);

    await assertAutoMigratedTables(adminPool, schemaName);
  } finally {
    if (auth1) {
      await auth1.shutdown().catch(() => undefined);
    }
    if (auth2) {
      await auth2.shutdown().catch(() => undefined);
    }

    await adminPool
      .query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
      .catch(() => undefined);
    await adminPool.end();
  }
});

function buildPasswordOnlyConfig(databaseUrl: string): OmniAuthConfig {
  return {
    appName: 'omni-auth-e2e',
    baseUrl: 'http://127.0.0.1:3000',
    routePrefix: '/auth',
    database: {
      provider: 'postgres',
      url: databaseUrl,
    },
    session: {
      strategy: 'jwt',
      accessTokenTtl: '15m',
      refreshTokenTtl: '30d',
      issuer: 'omni-auth-e2e',
      audience: 'e2e-test',
      secret: 'e2e-test-secret',
    },
    providers: [
      {
        type: 'password',
        enabled: true,
        allowUsername: true,
        allowEmail: true,
        allowPhone: true,
      },
    ],
  };
}

function withSearchPath(connectionString: string, schemaName: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  return url.toString();
}

function buildSchemaName(prefix: string): string {
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `${prefix}_${Date.now()}_${random}`;
}

async function assertAutoMigratedTables(pool: Pool, schemaName: string): Promise<void> {
  const requiredTables = [
    'users',
    'identities',
    'credentials',
    'verification_tokens',
    'oauth_states',
    'sessions',
    'omni_auth_schema_migrations',
  ];

  const rows = await pool.query<{ table_name: string }>(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_name = ANY($2::text[])
    `,
    [schemaName, requiredTables],
  );

  const existing = new Set(rows.rows.map((row) => row.table_name));
  for (const tableName of requiredTables) {
    assert.equal(existing.has(tableName), true, `missing table: ${schemaName}.${tableName}`);
  }
}