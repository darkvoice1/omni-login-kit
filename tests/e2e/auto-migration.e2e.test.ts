import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { it } from 'node:test';
import express from 'express';
import { Pool } from 'pg';
import { createAuthRouter, OmniAuth, PostgresStorageAdapter } from '../../src/index.js';
import type { OmniAuthConfig } from '../../src/types/auth-config.js';

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

it('E2E：应在初始化时自动迁移并完成密码登录主链路', async (t) => {
  const baseDatabaseUrl =
    process.env.E2E_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;

  const adminPool = new Pool({ connectionString: baseDatabaseUrl });
  let auth: OmniAuth | undefined;
  let server: import('node:http').Server | undefined;

  const schemaName = buildSchemaName();

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

    const config: OmniAuthConfig = {
      appName: 'omni-auth-e2e',
      baseUrl: 'http://127.0.0.1:3000',
      routePrefix: '/auth',
      database: {
        provider: 'postgres',
        url: isolatedDatabaseUrl,
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

    const storage = new PostgresStorageAdapter(isolatedDatabaseUrl);
    auth = new OmniAuth({ config, storage });

    const app = express();
    app.use(express.json());

    // auto migration is triggered here
    await auth.initialize();
    app.use(config.routePrefix, createAuthRouter(auth));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });

    if (!server) {
      throw new Error('failed to start e2e server');
    }

    const address = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${address.port}`;

    await assertAutoMigratedTables(adminPool, schemaName);

    const healthResponse = await fetch(`${serverUrl}/auth/health`);
    assert.equal(healthResponse.status, 200);

    const registerResponse = await fetch(`${serverUrl}/auth/register/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: 'e2e_user_001',
        password: '12345678',
        displayName: 'E2E User',
      }),
    });
    assert.equal(registerResponse.status, 201);

    const loginResponse = await fetch(`${serverUrl}/auth/login/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account: 'e2e_user_001',
        password: '12345678',
      }),
    });
    assert.equal(loginResponse.status, 200);

    const loginBody = (await loginResponse.json()) as {
      accessToken?: string;
      refreshToken?: string;
      sessionId?: string;
    };

    assert.equal(typeof loginBody.accessToken, 'string');
    assert.equal(typeof loginBody.refreshToken, 'string');
    assert.equal(typeof loginBody.sessionId, 'string');
  } finally {
    if (server) {
      const runningServer = server;
      await new Promise<void>((resolve) => runningServer.close(() => resolve()));
    }

    if (auth) {
      await auth.shutdown();
    }

    await adminPool
      .query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
      .catch(() => undefined);
    await adminPool.end();
  }
});

function withSearchPath(connectionString: string, schemaName: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  return url.toString();
}

function buildSchemaName(): string {
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `omni_auth_e2e_${Date.now()}_${random}`;
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