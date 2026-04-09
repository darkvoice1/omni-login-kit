import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { MessageSenderRegistry } from '../../src/services/messaging/message-sender.js';
import { EmailMagicLinkProvider } from '../../src/providers/email/email-magic-link-provider.js';
import type { ProviderContext } from '../../src/providers/base/types.js';
import { PostgresStorageAdapter } from '../../src/index.js';
import type { EmailMagicLinkProviderConfig } from '../../src/types/auth-config.js';
import { VerificationService } from '../../src/services/verification/verification-service.js';
import { IdentityService } from '../../src/services/identity/identity-service.js';
import { PasswordService } from '../../src/services/password/password-service.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

describe('EmailMagicLinkProvider 集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const verificationService = new VerificationService(storage);
  const identityService = new IdentityService(storage);
  const passwordService = new PasswordService();
  const sentMessages: Array<{ target: string; payload: Record<string, string> }> = [];
  const messageSenderRegistry = new MessageSenderRegistry();

  const providerConfig: EmailMagicLinkProviderConfig = {
    type: 'email_magic_link',
    enabled: true,
    sender: 'smtp-default',
    expiresInSeconds: 300,
  };

  messageSenderRegistry.register('smtp-default', {
    send: async (input) => {
      sentMessages.push({
        target: input.target,
        payload: input.payload,
      });
    },
  });

  const provider = new EmailMagicLinkProvider(providerConfig);
  const existingEmail = 'existing-email-magic-link@example.com';
  const newEmail = 'new-email-magic-link@example.com';
  const context: ProviderContext = {
    config: {
      appName: 'email-magic-link-provider-test',
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
        issuer: 'test',
        audience: 'test',
        secret: 'secret',
      },
      providers: [providerConfig],
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
    },
    storage,
    logger: console,
    sessionManager: {} as ProviderContext['sessionManager'],
    identityService,
    verificationService,
    passwordService,
    messageSenderRegistry,
  };

  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);
    await storage.connect();
    await provider.initialize(context);
  });

  after(async () => {
    await cleanupByEmail(pool, existingEmail);
    await cleanupByEmail(pool, newEmail);
    await storage.disconnect();
    await pool.end();
  });

  it('应该请求邮箱魔法链接成功', async () => {
    await cleanupByEmail(pool, existingEmail);
    sentMessages.length = 0;

    const result = await provider.requestMagicLink({
      email: existingEmail,
    });

    assert.equal(result.ok, true);
    assert.equal(result.metadata?.target, existingEmail);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].target, existingEmail);

    const sentMagicLink = sentMessages[0].payload.magicLink;
    assert.equal(typeof sentMagicLink, 'string');
    const url = new URL(sentMagicLink);
    assert.equal(url.pathname, '/auth/email-magic-link/callback');
    assert.equal(url.searchParams.get('email'), existingEmail);
    assert.equal(typeof url.searchParams.get('token'), 'string');
    assert.equal((url.searchParams.get('token') ?? '').length > 0, true);

    const rows = await pool.query(
      'SELECT * FROM verification_tokens WHERE target = $1 ORDER BY created_at DESC LIMIT 1',
      [existingEmail],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].channel, 'magic_link');
    assert.equal(rows.rows[0].max_attempts, 1);
    assert.equal(rows.rows[0].consumed_at, null);
  });

  it('应该让已有邮箱身份通过魔法链接登录', async () => {
    await cleanupByEmail(pool, existingEmail);
    sentMessages.length = 0;
    const seeded = await seedEmailMagicLinkAccount(pool, existingEmail);

    await provider.requestMagicLink({ email: existingEmail });
    const token = readTokenFromMagicLink(sentMessages[0].payload.magicLink);
    const loginResult = await provider.authenticate({
      email: existingEmail,
      token,
    });

    assert.equal(loginResult.userId, seeded.userId);
    assert.equal(loginResult.identityId, seeded.identityId);
    assert.equal(loginResult.isNewUser, false);
    assert.deepEqual(loginResult.metadata, { loginType: 'email_magic_link' });
  });

  it('应该在邮箱魔法链接登录时自动创建新用户', async () => {
    await cleanupByEmail(pool, newEmail);
    sentMessages.length = 0;

    await provider.requestMagicLink({ email: newEmail });
    const token = readTokenFromMagicLink(sentMessages[0].payload.magicLink);
    const loginResult = await provider.authenticate({
      email: newEmail,
      token,
    });

    assert.equal(loginResult.isNewUser, true);
    assert.equal(typeof loginResult.userId, 'string');
    assert.equal(typeof loginResult.identityId, 'string');
    assert.deepEqual(loginResult.metadata, { loginType: 'email_magic_link' });

    const createdUser = await pool.query('SELECT * FROM users WHERE id = $1', [loginResult.userId]);
    assert.equal(createdUser.rowCount, 1);
    assert.equal(createdUser.rows[0].email, newEmail);

    const createdIdentity = await pool.query('SELECT * FROM identities WHERE id = $1', [loginResult.identityId]);
    assert.equal(createdIdentity.rowCount, 1);
    assert.equal(createdIdentity.rows[0].provider_type, 'email_magic_link');
    assert.equal(createdIdentity.rows[0].email, newEmail);
  });

  it('应该拒绝重复消费同一条魔法链接', async () => {
    await cleanupByEmail(pool, existingEmail);
    sentMessages.length = 0;

    await provider.requestMagicLink({ email: existingEmail });
    const token = readTokenFromMagicLink(sentMessages[0].payload.magicLink);

    await provider.authenticate({
      email: existingEmail,
      token,
    });

    await assert.rejects(
      async () => {
        await provider.authenticate({
          email: existingEmail,
          token,
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'VERIFY_TOKEN_001');
        return true;
      },
    );
  });
});

function readTokenFromMagicLink(magicLink: string): string {
  const url = new URL(magicLink);
  const token = url.searchParams.get('token');
  assert.equal(typeof token, 'string');
  assert.equal((token ?? '').length > 0, true);
  return token as string;
}

async function seedEmailMagicLinkAccount(
  pool: Pool,
  email: string,
): Promise<{ userId: string; identityId: string }> {
  const userRows = await pool.query(
    `
    INSERT INTO users (display_name, email, status)
    VALUES ($1, $2, 'active')
    RETURNING id
    `,
    [email, email],
  );

  const userId = userRows.rows[0].id as string;
  const identityRows = await pool.query(
    `
    INSERT INTO identities (user_id, provider_type, provider_subject, email, metadata)
    VALUES ($1, 'email_magic_link', $2, $2, '{}'::jsonb)
    RETURNING id
    `,
    [userId, email],
  );

  return {
    userId,
    identityId: identityRows.rows[0].id as string,
  };
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
