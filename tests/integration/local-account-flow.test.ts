import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { OmniAuth, PostgresStorageAdapter } from '../../src/index.js';
import type { OmniAuthConfig } from '../../src/types/auth-config.js';

/**
 * 测试数据库连接串。
 *
 * 这里优先允许外部环境覆盖，方便后续接 GitHub CI。
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

/**
 * 测试用认证配置。
 */
const testAuthConfig: OmniAuthConfig = {
  appName: 'omni-login-kit-test',
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
    issuer: 'omni-login-kit-test',
    audience: 'integration-test',
    secret: 'integration-secret',
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

/**
 * 阶段三本地账号体系集成测试。
 */
describe('本地账号体系集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const auth = new OmniAuth({ config: testAuthConfig, storage });
  const account = 'integration_user';
  const displayName = '集成测试用户';
  const oldPassword = '12345678';
  const newPassword = '87654321';

  /**
   * 在测试开始前，先执行一次 migration，并初始化认证系统。
   */
  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);
    await auth.initialize();
  });

  /**
   * 测试完成后关闭连接。
   */
  after(async () => {
    await cleanupAccount(pool, account);
    await auth.shutdown();
    await pool.end();
  });

  /**
   * 测试完整链路：注册 -> 登录 -> 退出 -> 重置密码 -> 新密码登录。
   */
  it('应该打通本地账号主流程', async () => {
    await cleanupAccount(pool, account);

    // 1. 先注册账号，并验证三张核心表都写入了数据。
    const registerResult = await auth.registerWithPassword({
      account,
      password: oldPassword,
      displayName,
    });

    assert.equal(registerResult.isNewUser, true);
    assert.equal(typeof registerResult.userId, 'string');
    assert.equal(typeof registerResult.identityId, 'string');

    const createdUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [registerResult.userId],
    );
    assert.equal(createdUser.rowCount, 1);
    assert.equal(createdUser.rows[0].display_name, displayName);

    const createdIdentity = await pool.query(
      'SELECT * FROM identities WHERE id = $1',
      [registerResult.identityId],
    );
    assert.equal(createdIdentity.rowCount, 1);
    assert.equal(createdIdentity.rows[0].username, account);

    const createdCredential = await pool.query(
      'SELECT * FROM credentials WHERE identity_id = $1',
      [registerResult.identityId],
    );
    assert.equal(createdCredential.rowCount, 1);
    assert.equal(createdCredential.rows[0].password_algo, 'scrypt');

    // 2. 使用旧密码登录，确认 token 和 session 被创建。
    const loginResult = await auth.authenticateWithCredentials('password', {
      account,
      password: oldPassword,
    });

    assert.equal(loginResult.userId, registerResult.userId);
    assert.equal(loginResult.identityId, registerResult.identityId);
    assert.equal(typeof loginResult.accessToken, 'string');
    assert.equal(typeof loginResult.refreshToken, 'string');
    assert.equal(typeof loginResult.sessionId, 'string');

    const createdSession = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [loginResult.sessionId],
    );
    assert.equal(createdSession.rowCount, 1);
    assert.equal(createdSession.rows[0].revoked_at, null);

    // 3. 退出登录，确认 session 已被撤销。
    const logoutResult = await auth.logout({ sessionId: loginResult.sessionId });
    assert.equal(logoutResult.ok, true);

    const revokedSession = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [loginResult.sessionId],
    );
    assert.equal(revokedSession.rowCount, 1);
    assert.notEqual(revokedSession.rows[0].revoked_at, null);

    // 4. 重置密码，并确认旧密码失效、新密码生效。
    const resetResult = await auth.resetPassword({
      account,
      oldPassword,
      newPassword,
    });
    assert.equal(resetResult.ok, true);

    await assert.rejects(
      async () => {
        await auth.authenticateWithCredentials('password', {
          account,
          password: oldPassword,
        });
      },
      {
        code: 'AUTH_CREDENTIALS_001',
      },
    );

    const loginWithNewPassword = await auth.authenticateWithCredentials('password', {
      account,
      password: newPassword,
    });
    assert.equal(loginWithNewPassword.userId, registerResult.userId);
    assert.equal(typeof loginWithNewPassword.sessionId, 'string');
  });
});

/**
 * 清理指定测试账号相关的数据。
 */
async function cleanupAccount(pool: Pool, account: string): Promise<void> {
  const identityRows = await pool.query<{
    id: string;
    user_id: string;
  }>(
    `
    SELECT id, user_id
    FROM identities
    WHERE username = $1 OR email = $1 OR phone = $1
    `,
    [account],
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
