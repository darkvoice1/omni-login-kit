import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { PostgresStorageAdapter } from '../../src/index.js';
import { VerificationService } from '../../src/services/verification/verification-service.js';

/**
 * 测试数据库连接串。
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

/**
 * 阶段四验证码能力中心集成测试。
 */
describe('验证码能力中心集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const verificationService = new VerificationService(storage);
  const target = 'code-test@example.com';
  const senderName = 'smtp-default';

  /**
   * 在测试开始前，执行 migration 并初始化存储层。
   */
  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);
    await storage.connect();
  });

  /**
   * 测试结束后关闭数据库连接。
   */
  after(async () => {
    await cleanupVerificationTokens(pool, target);
    await storage.disconnect();
    await pool.end();
  });

  /**
   * 测试创建验证码并成功校验的主流程。
   */
  it('应该创建验证码并在校验成功后消费记录', async () => {
    await cleanupVerificationTokens(pool, target);

    const created = await verificationService.createCodeToken({
      target,
      scene: 'login',
      channel: 'email',
      senderName,
      expiresInSeconds: 300,
      codeLength: 6,
    });

    assert.equal(created.plainCode.length, 6);
    assert.equal(created.record.target, target);
    assert.equal(created.record.channel, 'email');
    assert.equal(created.record.senderName, senderName);

    const insertedRows = await pool.query(
      'SELECT * FROM verification_tokens WHERE id = $1',
      [created.record.id],
    );
    assert.equal(insertedRows.rowCount, 1);
    assert.equal(insertedRows.rows[0].consumed_at, null);
    assert.equal(insertedRows.rows[0].attempt_count, 0);

    const verifiedRecord = await verificationService.verifyToken({
      target,
      scene: 'login',
      channel: 'email',
      plainToken: created.plainCode,
    });

    assert.equal(verifiedRecord.id, created.record.id);

    const consumedRows = await pool.query(
      'SELECT * FROM verification_tokens WHERE id = $1',
      [created.record.id],
    );
    assert.equal(consumedRows.rowCount, 1);
    assert.notEqual(consumedRows.rows[0].consumed_at, null);
  });

  /**
   * 测试错误验证码会增加尝试次数。
   */
  it('应该在验证码错误时增加尝试次数', async () => {
    await cleanupVerificationTokens(pool, target);

    const created = await verificationService.createCodeToken({
      target,
      scene: 'login',
      channel: 'email',
      senderName,
      expiresInSeconds: 300,
      codeLength: 6,
    });

    await assert.rejects(
      async () => {
        await verificationService.verifyToken({
          target,
          scene: 'login',
          channel: 'email',
          plainToken: '000000',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'VERIFY_CODE_001');
        return true;
      },
    );

    const retriedRows = await pool.query(
      'SELECT * FROM verification_tokens WHERE id = $1',
      [created.record.id],
    );
    assert.equal(retriedRows.rowCount, 1);
    assert.equal(retriedRows.rows[0].attempt_count, 1);
  });

  /**
   * 测试过期验证码会被拒绝。
   */
  it('应该拒绝已过期的验证码', async () => {
    await cleanupVerificationTokens(pool, target);

    const created = await verificationService.createCodeToken({
      target,
      scene: 'login',
      channel: 'email',
      senderName,
      expiresInSeconds: 1,
      codeLength: 6,
    });

    await pool.query(
      'UPDATE verification_tokens SET expires_at = now() - interval \'1 minute\' WHERE id = $1',
      [created.record.id],
    );

    await assert.rejects(
      async () => {
        await verificationService.verifyToken({
          target,
          scene: 'login',
          channel: 'email',
          plainToken: created.plainCode,
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'VERIFY_CODE_002');
        return true;
      },
    );
  });
});

/**
 * 清理指定目标相关的验证码记录。
 */
async function cleanupVerificationTokens(pool: Pool, target: string): Promise<void> {
  await pool.query('DELETE FROM verification_tokens WHERE target = $1', [target]);
}
