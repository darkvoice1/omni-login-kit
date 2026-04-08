import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { SessionManager } from '../../src/services/session/session-manager.js';
import type { SessionConfig } from '../../src/types/auth-config.js';
import type {
  CredentialRepository,
  IdentityRepository,
  OAuthStateRepository,
  SessionRepository,
  StorageAdapter,
  UserRepository,
  VerificationTokenRepository,
} from '../../src/storage/storage-adapter.js';

/**
 * 创建测试用会话配置。
 */
function createSessionConfig(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    strategy: 'jwt',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    issuer: 'omni-login-kit-test',
    audience: 'unit-test',
    secret: 'test-secret-key',
    ...overrides,
  };
}

/**
 * 创建测试用存储层。
 */
function createStorage(sessionRepository: SessionRepository): StorageAdapter {
  const storage: StorageAdapter = {
    users: {} as UserRepository,
    identities: {} as IdentityRepository,
    credentials: {} as CredentialRepository,
    verificationTokens: {} as VerificationTokenRepository,
    oauthStates: {} as OAuthStateRepository,
    sessions: sessionRepository,
    connect: async () => undefined,
    disconnect: async () => undefined,
    transaction: async <T>(handler: (storage: StorageAdapter) => Promise<T>) => handler(storage),
  };

  return storage;
}

/**
 * SessionManager 单元测试。
 */
describe('SessionManager', () => {
  /**
   * 测试登录态签发和 Access Token 校验主流程。
   */
  it('应该创建登录态并能校验 Access Token', async () => {
    let capturedCreateInput: Parameters<SessionRepository['create']>[0] | undefined;

    const storage = createStorage({
      create: async (input) => {
        capturedCreateInput = input;
        return {
          id: 'session-test-id',
          userId: input.userId,
          refreshTokenHash: input.refreshTokenHash,
          deviceInfo: input.deviceInfo,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          expiresAt: input.expiresAt,
          revokedAt: undefined,
          lastSeenAt: undefined,
          createdAt: new Date(),
        };
      },
      findByRefreshTokenHash: async () => null,
      revoke: async () => undefined,
    });

    const sessionManager = new SessionManager(createSessionConfig(), storage);
    const result = await sessionManager.createSessionTokens({
      userId: 'user-test-id',
      ipAddress: '127.0.0.1',
      userAgent: 'unit-test-agent',
    });

    assert.equal(result.sessionId, 'session-test-id');
    assert.equal(typeof result.refreshToken, 'string');
    assert.equal(result.refreshToken.length > 0, true);
    assert.equal(typeof result.accessToken, 'string');
    assert.equal(result.accessToken.length > 0, true);
    assert.equal(capturedCreateInput?.userId, 'user-test-id');

    const payload = sessionManager.verifyAccessToken(result.accessToken);
    assert.equal(payload.sub, 'user-test-id');
    assert.equal(payload.sid, 'session-test-id');
    assert.equal(payload.type, 'access_token');
  });

  /**
   * 测试非法时长配置会在签发阶段抛错。
   */
  it('应该拒绝非法的 refreshToken 时长配置', async () => {
    const storage = createStorage({
      create: async () => {
        throw new Error('不应该执行到这里');
      },
      findByRefreshTokenHash: async () => null,
      revoke: async () => undefined,
    });

    const sessionManager = new SessionManager(
      createSessionConfig({
        refreshTokenTtl: 'invalid' as SessionConfig['refreshTokenTtl'],
      }),
      storage,
    );

    await assert.rejects(
      async () => {
        await sessionManager.createSessionTokens({ userId: 'user-test-id' });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'CFG_SESSION_001');
        return true;
      },
    );
  });

  /**
   * 测试撤销会话时会正确把 sessionId 传给存储层。
   */
  it('应该撤销指定会话', async () => {
    let revokedSessionId: string | undefined;
    let revokedAtValue: Date | undefined;

    const storage = createStorage({
      create: async () => {
        throw new Error('当前测试不会调用 create');
      },
      findByRefreshTokenHash: async () => null,
      revoke: async (sessionId, revokedAt) => {
        revokedSessionId = sessionId;
        revokedAtValue = revokedAt;
      },
    });

    const sessionManager = new SessionManager(createSessionConfig(), storage);
    await sessionManager.revokeSession('session-to-revoke');

    assert.equal(revokedSessionId, 'session-to-revoke');
    assert.equal(revokedAtValue instanceof Date, true);
  });
});
