import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createAuthRouter, OmniAuth, PostgresStorageAdapter } from '../../src/index.js';
import type { OmniAuthConfig } from '../../src/types/auth-config.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

const testAuthConfig: OmniAuthConfig = {
  appName: 'email-magic-link-router-test',
  baseUrl: 'http://localhost:3000',
  routePrefix: '/auth',
  database: {
    provider: 'postgres',
    url: TEST_DATABASE_URL,
  },
  session: {
    strategy: 'jwt',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    issuer: 'email-magic-link-router-test',
    audience: 'integration-test',
    secret: 'integration-secret',
  },
  providers: [
    {
      type: 'email_magic_link',
      enabled: true,
      sender: 'smtp-default',
      expiresInSeconds: 300,
    },
  ],
  senders: {
    'smtp-default': {
      type: 'smtp',
      host: 'localhost',
      port: 1025,
      user: 'tester',
      password: 'tester',
      from: 'test@example.com',
    },
  },
};

describe('邮箱魔法链接路由集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const auth = new OmniAuth({ config: testAuthConfig, storage });
  const sentMessages: Array<{ target: string; payload: Record<string, string> }> = [];
  const requestEmail = 'router-request@example.com';
  const loginEmail = 'router-login@example.com';
  const replayEmail = 'router-replay@example.com';
  let server: import('node:http').Server | undefined;
  let serverUrl = '';

  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);

    await auth.initialize();
    auth.messageSenderRegistry.register('smtp-default', {
      send: async (input) => {
        sentMessages.push({
          target: input.target,
          payload: input.payload,
        });
      },
    });

    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(auth));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server?.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await cleanupByEmail(pool, requestEmail);
    await cleanupByEmail(pool, loginEmail);
    await cleanupByEmail(pool, replayEmail);

    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }

    await auth.shutdown();
    await pool.end();
  });

  it('应该通过路由请求邮箱魔法链接', async () => {
    await cleanupByEmail(pool, requestEmail);
    sentMessages.length = 0;

    const response = await fetch(`${serverUrl}/auth/email-magic-link/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: requestEmail }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; metadata?: Record<string, unknown> };
    assert.equal(body.ok, true);
    assert.equal(body.metadata?.target, requestEmail);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].target, requestEmail);

    const rows = await pool.query(
      'SELECT * FROM verification_tokens WHERE target = $1 ORDER BY created_at DESC LIMIT 1',
      [requestEmail],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].channel, 'magic_link');
    assert.equal(rows.rows[0].consumed_at, null);
  });

  it('应该通过回调消费 token 并完成登录', async () => {
    await cleanupByEmail(pool, loginEmail);
    sentMessages.length = 0;

    const requestResponse = await fetch(`${serverUrl}/auth/email-magic-link/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: loginEmail }),
    });
    assert.equal(requestResponse.status, 200);
    assert.equal(sentMessages.length, 1);

    const token = readTokenFromMagicLink(sentMessages[0].payload.magicLink);
    const callbackResponse = await fetch(
      `${serverUrl}/auth/email-magic-link/callback?email=${encodeURIComponent(loginEmail)}&token=${encodeURIComponent(token)}`,
      {
        headers: {
          'user-agent': 'router-integration-test',
        },
      },
    );

    assert.equal(callbackResponse.status, 200);
    const loginBody = (await callbackResponse.json()) as {
      userId: string;
      identityId: string;
      isNewUser: boolean;
      accessToken: string;
      refreshToken: string;
      sessionId: string;
    };

    assert.equal(loginBody.isNewUser, true);
    assert.equal(typeof loginBody.userId, 'string');
    assert.equal(typeof loginBody.identityId, 'string');
    assert.equal(typeof loginBody.accessToken, 'string');
    assert.equal(typeof loginBody.refreshToken, 'string');
    assert.equal(typeof loginBody.sessionId, 'string');

    const userRows = await pool.query('SELECT * FROM users WHERE id = $1', [loginBody.userId]);
    assert.equal(userRows.rowCount, 1);
    assert.equal(userRows.rows[0].email, loginEmail);

    const identityRows = await pool.query('SELECT * FROM identities WHERE id = $1', [loginBody.identityId]);
    assert.equal(identityRows.rowCount, 1);
    assert.equal(identityRows.rows[0].provider_type, 'email_magic_link');
    assert.equal(identityRows.rows[0].email, loginEmail);

    const sessionRows = await pool.query('SELECT * FROM sessions WHERE id = $1', [loginBody.sessionId]);
    assert.equal(sessionRows.rowCount, 1);
    assert.equal(sessionRows.rows[0].revoked_at, null);
  });

  it('应该拒绝重复消费同一条魔法链接', async () => {
    await cleanupByEmail(pool, replayEmail);
    sentMessages.length = 0;

    const requestResponse = await fetch(`${serverUrl}/auth/email-magic-link/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: replayEmail }),
    });
    assert.equal(requestResponse.status, 200);

    const token = readTokenFromMagicLink(sentMessages[0].payload.magicLink);
    const url = `${serverUrl}/auth/email-magic-link/callback?email=${encodeURIComponent(replayEmail)}&token=${encodeURIComponent(token)}`;

    const firstResponse = await fetch(url);
    assert.equal(firstResponse.status, 200);

    const secondResponse = await fetch(url);
    assert.equal(secondResponse.status, 400);
    const body = (await secondResponse.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'VERIFY_TOKEN_001');
  });
});

function readTokenFromMagicLink(magicLink: string): string {
  const url = new URL(magicLink);
  const token = url.searchParams.get('token');
  assert.equal(typeof token, 'string');
  assert.equal((token ?? '').length > 0, true);
  return token as string;
}

async function cleanupByEmail(pool: Pool, email: string): Promise<void> {
  await pool.query('DELETE FROM verification_tokens WHERE target = $1', [email]);

  const identityRows = await pool.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM identities WHERE email = $1',
    [email],
  );

  const identityIds = identityRows.rows.map((row) => row.id);
  const userIds = [...new Set(identityRows.rows.map((row) => row.user_id))];

  if (identityIds.length > 0) {
    await pool.query('DELETE FROM credentials WHERE identity_id = ANY($1::uuid[])', [identityIds]);
    await pool.query('DELETE FROM identities WHERE id = ANY($1::uuid[])', [identityIds]);
  }

  if (userIds.length > 0) {
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM verification_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
}
