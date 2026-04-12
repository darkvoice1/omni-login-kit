import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Pool } from 'pg';
import { OmniAuth, PostgresStorageAdapter } from '../../src/index.js';
import type { OmniAuthConfig } from '../../src/types/auth-config.js';

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

it('E2E：当角色无迁移权限时应返回明确错误', async (t) => {
  const baseDatabaseUrl =
    process.env.E2E_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;

  const adminPool = new Pool({ connectionString: baseDatabaseUrl });
  const schemaName = buildName('omni_auth_e2e_perm_schema');
  const roleName = buildName('omni_auth_e2e_perm_role');
  const rolePassword = buildPassword();
  let auth: OmniAuth | undefined;

  try {
    try {
      await adminPool.query('SELECT 1');
    } catch (error) {
      t.skip(`skip e2e: cannot connect database (${String(error)})`);
      return;
    }

    const dbName = readDatabaseName(baseDatabaseUrl);
    if (!dbName || !isSafeIdent(dbName)) {
      t.skip('skip e2e: database name is missing or unsafe for identifier SQL');
      return;
    }

    if (!isSafeIdent(schemaName) || !isSafeIdent(roleName)) {
      t.skip('skip e2e: generated role/schema name is unsafe');
      return;
    }

    try {
      await adminPool.query(`CREATE SCHEMA ${schemaName}`);
      await adminPool.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await adminPool.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${roleName}`);
      await adminPool.query(`GRANT USAGE ON SCHEMA ${schemaName} TO ${roleName}`);
    } catch (error) {
      t.skip(`skip e2e: cannot prepare restricted role (${String(error)})`);
      return;
    }

    const restrictedUrl = withRoleAndSearchPath(baseDatabaseUrl, roleName, rolePassword, schemaName);
    const config = buildPasswordOnlyConfig(restrictedUrl);

    auth = new OmniAuth({
      config,
      storage: new PostgresStorageAdapter(restrictedUrl),
    });

    if (!auth) {
      t.skip('skip e2e: auth instance is not ready');
      return;
    }

    await assert.rejects(async () => {
      await auth.initialize();
    }, (error: unknown) => {
      const err = error as {
        code?: string;
        message?: string;
        cause?: { message?: string } | unknown;
      };

      assert.equal(err.code, 'DB_QUERY_001');
      assert.equal(typeof err.message, 'string');
      assert.equal((err.message ?? '').includes('PostgreSQL'), true);

      const causeMessage = String((err.cause as { message?: string } | undefined)?.message ?? '');
      assert.equal(causeMessage.length > 0, true);
      return true;
    });
  } finally {
    if (auth) {
      await auth.shutdown().catch(() => undefined);
    }

    await adminPool
      .query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1', [roleName])
      .catch(() => undefined);

    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => undefined);
    await adminPool.query(`DROP ROLE IF EXISTS ${roleName}`).catch(() => undefined);
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

function withRoleAndSearchPath(
  connectionString: string,
  roleName: string,
  rolePassword: string,
  schemaName: string,
): string {
  const url = new URL(connectionString);
  url.username = roleName;
  url.password = rolePassword;
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  return url.toString();
}

function readDatabaseName(connectionString: string): string | null {
  const url = new URL(connectionString);
  const name = url.pathname.replace(/^\//, '').trim();
  return name || null;
}

function buildName(prefix: string): string {
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `${prefix}_${Date.now()}_${random}`;
}

function buildPassword(): string {
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `pw_${Date.now()}_${random}`;
}

function isSafeIdent(value: string): boolean {
  return /^[a-z0-9_]+$/.test(value);
}