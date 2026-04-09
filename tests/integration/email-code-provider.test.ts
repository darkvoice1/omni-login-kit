import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { EmailCodeProvider } from '../../src/providers/email/email-code-provider.js';
import type { ProviderContext } from '../../src/providers/base/types.js';
import { PostgresStorageAdapter } from '../../src/index.js';
import type { EmailCodeProviderConfig } from '../../src/types/auth-config.js';
import { VerificationService } from '../../src/services/verification/verification-service.js';
import { IdentityService } from '../../src/services/identity/identity-service.js';
import { PasswordService } from '../../src/services/password/password-service.js';

/**
 * 测试数据库连接串。
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

/**
 * EmailCodeProvider 集成测试。
 */
describe('EmailCodeProvider 集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const verificationService = new VerificationService(storage);
  const identityService = new IdentityService(storage);
  const passwordService = new PasswordService();

  const providerConfig: EmailCodeProviderConfig = {
    type: 'email_code',
    enabled: true,
    sender: 'smtp-default',
    codeLength: 6,
    expiresInSeconds: 300,
  };

  const provider = new EmailCodeProvider(providerConfig);
  const existingEmail = 'existing-email-code@example.com';
  const newEmail = 'new-email-code@example.com';
  const context: ProviderContext = {
    config: {
      appName: 'email-code-provider-test',
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
  };

  /**
   * 在测试前执行 migration 并初始化 Provider。
   */
  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);
    await storage.connect();
    await provider.initialize(context);
  });

  /**
   * 测试后清理并关闭连接。
   */
  after(async () => {
    await cleanupByEmail(pool, existingEmail);
    await cleanupByEmail(pool, newEmail);
    await storage.disconnect();
    await pool.end();
  });

  /**
   * 测试请求验证码会写入数据库并返回调试元信息。
   */
  it('应该请求邮箱验证码成功', async () => {
    await cleanupByEmail(pool, existingEmail);

    const result = await provider.requestCode({
      email: existingEmail,
    });

    assert.equal(result.ok, true);
    assert.equal(typeof result.metadata?.plainCode, 'string');
    assert.equal(result.metadata?.target, existingEmail);

    const rows = await pool.query(
      'SELECT * FROM verification_tokens WHERE target = $1 ORDER BY created_at DESC LIMIT 1',
      [existingEmail],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].channel, 'email');
    assert.equal(rows.rows[0].consumed_at, null);
  });

  /**
   * 测试已有用户的邮箱验证码登录。
   */
  it('应该让已有邮箱身份通过验证码登录', async () => {
    await cleanupByEmail(pool, existingEmail);
    const seeded = await seedEmailCodeAccount(pool, existingEmail);

    const codeResult = await provider.requestCode({ email: existingEmail });
    const loginResult = await provider.authenticate({
      email: existingEmail,
      code: codeResult.metadata?.plainCode,
    });

    assert.equal(loginResult.userId, seeded.userId);
    assert.equal(loginResult.identityId, seeded.identityId);
    assert.equal(loginResult.isNewUser, false);
    assert.deepEqual(loginResult.metadata, { loginType: 'email_code' });
  });

  /**
   * 测试不存在用户时会自动创建用户与身份。
   */
  it('应该在邮箱验证码登录时自动创建新用户', async () => {
    await cleanupByEmail(pool, newEmail);

    const codeResult = await provider.requestCode({ email: newEmail });
    const loginResult = await provider.authenticate({
      email: newEmail,
      code: codeResult.metadata?.plainCode,
    });

    assert.equal(loginResult.isNewUser, true);
    assert.equal(typeof loginResult.userId, 'string');
    assert.equal(typeof loginResult.identityId, 'string');
    assert.deepEqual(loginResult.metadata, { loginType: 'email_code' });

    const createdUser = await pool.query('SELECT * FROM users WHERE id = $1', [loginResult.userId]);
    assert.equal(createdUser.rowCount, 1);
    assert.equal(createdUser.rows[0].email, newEmail);

    const createdIdentity = await pool.query('SELECT * FROM identities WHERE id = $1', [loginResult.identityId]);
    assert.equal(createdIdentity.rowCount, 1);
    assert.equal(createdIdentity.rows[0].provider_type, 'email_code');
    assert.equal(createdIdentity.rows[0].email, newEmail);
  });

  /**
   * 测试错误验证码会登录失败。
   */
  it('应该拒绝错误的邮箱验证码', async () => {
    await cleanupByEmail(pool, existingEmail);

    await provider.requestCode({ email: existingEmail });

    await assert.rejects(
      async () => {
        await provider.authenticate({
          email: existingEmail,
          code: '000000',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'VERIFY_CODE_001');
        return true;
      },
    );
  });
});

/**
 * 为已有邮箱验证码登录测试预置一个用户和身份。
 */
async function seedEmailCodeAccount(pool: Pool, email: string): Promise<{ userId: string; identityId: string }> {
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
    VALUES ($1, 'email_code', $2, $2, '{}'::jsonb)
    RETURNING id
    `,
    [userId, email],
  );

  return {
    userId,
    identityId: identityRows.rows[0].id as string,
  };
}

/**
 * 清理指定邮箱相关的数据。
 */
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
