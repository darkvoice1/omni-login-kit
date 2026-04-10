import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresStorageAdapter } from '../../src/index.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

/**
 * OAuth state 仓储集成测试。
 */
describe('OAuthStateRepository 集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const providerType = 'oauth_state_repo_test';
  const txProviderType = 'oauth_state_repo_test_tx';

  /**
   * 启动前执行 migration 并建立存储连接。
   */
  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);
    await storage.connect();
  });

  /**
   * 测试结束后清理数据并断开连接。
   */
  after(async () => {
    await cleanupOAuthStates(pool, 'oauth_state_repo_test%');
    await storage.disconnect();
    await pool.end();
  });

  it('应该创建 OAuth state 记录', async () => {
    await cleanupOAuthStates(pool, providerType);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const created = await storage.oauthStates.create({
      providerType,
      stateHash: `state_hash_${Date.now()}_create`,
      redirectTo: '/dashboard',
      pkceVerifier: 'pkce_verifier_001',
      expiresAt,
    });

    assert.equal(created.providerType, providerType);
    assert.equal(created.redirectTo, '/dashboard');
    assert.equal(created.pkceVerifier, 'pkce_verifier_001');
    assert.equal(created.consumedAt, undefined);

    // 关键步骤：直接查库确认字段被正确持久化。
    const rows = await pool.query('SELECT * FROM oauth_states WHERE id = $1', [created.id]);
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].provider_type, providerType);
    assert.equal(rows.rows[0].consumed_at, null);
  });

  it('应该一次性消费 state，并拒绝重复或过期 state', async () => {
    await cleanupOAuthStates(pool, providerType);

    const stateHash = `state_hash_${Date.now()}_consume`;
    const created = await storage.oauthStates.create({
      providerType,
      stateHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const consumedAt = new Date();
    const consumed = await storage.oauthStates.consumeByStateHash(stateHash, consumedAt);
    assert.ok(consumed);
    assert.equal(consumed?.id, created.id);

    const consumedRows = await pool.query('SELECT * FROM oauth_states WHERE id = $1', [created.id]);
    assert.equal(consumedRows.rowCount, 1);
    assert.notEqual(consumedRows.rows[0].consumed_at, null);

    const consumedAgain = await storage.oauthStates.consumeByStateHash(stateHash, new Date());
    assert.equal(consumedAgain, null);

    const expiredHash = `state_hash_${Date.now()}_expired`;
    await storage.oauthStates.create({
      providerType,
      stateHash: expiredHash,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const consumeExpired = await storage.oauthStates.consumeByStateHash(expiredHash, new Date());
    assert.equal(consumeExpired, null);
  });

  it('应该在事务上下文中使用 oauthStates 仓储', async () => {
    await cleanupOAuthStates(pool, txProviderType);

    const txStateHash = `state_hash_${Date.now()}_tx`;

    await storage.transaction(async (txStorage) => {
      // 关键步骤：验证事务内拿到的是可用仓储，而不是占位实现。
      await txStorage.oauthStates.create({
        providerType: txProviderType,
        stateHash: txStateHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
    });

    const rows = await pool.query(
      'SELECT * FROM oauth_states WHERE provider_type = $1 AND state_hash = $2 LIMIT 1',
      [txProviderType, txStateHash],
    );
    assert.equal(rows.rowCount, 1);
  });
});

/**
 * 清理指定 provider 类型的 OAuth state 记录。
 */
async function cleanupOAuthStates(pool: Pool, providerTypeOrPattern: string): Promise<void> {
  if (providerTypeOrPattern.includes('%')) {
    await pool.query('DELETE FROM oauth_states WHERE provider_type LIKE $1', [providerTypeOrPattern]);
    return;
  }

  await pool.query('DELETE FROM oauth_states WHERE provider_type = $1', [providerTypeOrPattern]);
}
