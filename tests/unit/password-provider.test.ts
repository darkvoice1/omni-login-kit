import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { PasswordProvider } from '../../src/providers/password/password-provider.js';
import type { ProviderContext } from '../../src/providers/base/types.js';
import type { PasswordProviderConfig } from '../../src/types/auth-config.js';
import { PasswordService } from '../../src/services/password/password-service.js';
import type {
  CredentialRepository,
  IdentityRepository,
  OAuthStateRepository,
  SessionRepository,
  StorageAdapter,
  UserRepository,
  VerificationTokenRepository,
} from '../../src/storage/storage-adapter.js';
import type { IdentityService } from '../../src/services/identity/identity-service.js';
import type { VerificationService } from '../../src/services/verification/verification-service.js';
import type { Logger } from '../../src/utils/logger.js';

/**
 * 创建测试用密码 Provider 配置。
 */
function createPasswordProviderConfig(overrides?: Partial<PasswordProviderConfig>): PasswordProviderConfig {
  return {
    type: 'password',
    enabled: true,
    allowUsername: true,
    allowEmail: true,
    allowPhone: true,
    ...overrides,
  };
}

/**
 * 创建测试用 Provider 上下文。
 */
async function createPasswordProviderContext(): Promise<{
  context: ProviderContext;
  state: {
    touchedUserIds: string[];
    createdUsers: Array<{ id: string; displayName: string; email?: string; phone?: string }>;
    createdIdentities: Array<{ id: string; userId: string; username?: string; email?: string; phone?: string }>;
    upsertCalls: Array<{ identityId: string; passwordHash: string; passwordAlgo: string }>;
    identity: {
      id: string;
      userId: string;
      providerType: string;
      providerSubject: string;
      username?: string;
      email?: string;
      phone?: string;
      nickname?: string;
      avatarUrl?: string;
      metadata: Record<string, unknown>;
      lastUsedAt?: Date;
      createdAt: Date;
      updatedAt: Date;
    };
  };
}> {
  const passwordService = new PasswordService();
  const storedPassword = await passwordService.hashPassword('12345678');
  const now = new Date();

  const state = {
    touchedUserIds: [] as string[],
    createdUsers: [] as Array<{ id: string; displayName: string; email?: string; phone?: string }>,
    createdIdentities: [] as Array<{ id: string; userId: string; username?: string; email?: string; phone?: string }>,
    upsertCalls: [] as Array<{ identityId: string; passwordHash: string; passwordAlgo: string }>,
    identity: {
      id: 'identity-test-id',
      userId: 'user-test-id',
      providerType: 'password',
      providerSubject: 'password-subject',
      username: 'demo_user',
      email: 'demo@example.com',
      phone: '13800000000',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
  };

  const users: UserRepository = {
    findById: async (userId) => {
      if (userId === 'disabled-user') {
        return {
          id: userId,
          displayName: '禁用用户',
          status: 'disabled',
          createdAt: now,
          updatedAt: now,
        };
      }

      if (userId !== state.identity.userId) {
        return null;
      }

      return {
        id: state.identity.userId,
        displayName: '测试用户',
        email: state.identity.email,
        phone: state.identity.phone,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
    },
    findByEmail: async (email) => {
      if (email === 'occupied@example.com') {
        return {
          id: 'occupied-user',
          displayName: '已占用邮箱用户',
          email,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
      }
      return null;
    },
    findByPhone: async (phone) => {
      if (phone === '13900000000') {
        return {
          id: 'occupied-phone-user',
          displayName: '已占用手机号用户',
          phone,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
      }
      return null;
    },
    create: async (input) => {
      const created = {
        id: `user-created-${state.createdUsers.length + 1}`,
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
      };
      state.createdUsers.push(created);
      return {
        id: created.id,
        displayName: created.displayName,
        email: created.email,
        phone: created.phone,
        status: input.status,
        createdAt: now,
        updatedAt: now,
      };
    },
    updateLastLoginAt: async (userId) => {
      state.touchedUserIds.push(userId);
    },
  };

  const identities: IdentityRepository = {
    findByProvider: async () => null,
    findPasswordIdentityByIdentifier: async (input) => {
      if (
        (input.identifierType === 'username' && input.identifierValue === 'demo_user') ||
        (input.identifierType === 'email' && input.identifierValue === 'demo@example.com') ||
        (input.identifierType === 'phone' && input.identifierValue === '13800000000')
      ) {
        return state.identity;
      }

      if (input.identifierType === 'username' && input.identifierValue === 'taken_name') {
        return {
          ...state.identity,
          id: 'taken-identity',
          username: 'taken_name',
        };
      }

      return null;
    },
    create: async (input) => {
      const created = {
        id: `identity-created-${state.createdIdentities.length + 1}`,
        userId: input.userId,
        username: input.username,
        email: input.email,
        phone: input.phone,
      };
      state.createdIdentities.push(created);
      return {
        id: created.id,
        userId: input.userId,
        providerType: input.providerType,
        providerSubject: input.providerSubject,
        username: input.username,
        email: input.email,
        phone: input.phone,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
    },
    listByUserId: async () => [],
  };

  const credentials: CredentialRepository = {
    findByIdentityId: async (identityId) => {
      if (identityId === state.identity.id) {
        return {
          id: 'credential-test-id',
          identityId,
          passwordHash: storedPassword.passwordHash,
          passwordAlgo: storedPassword.passwordAlgo,
          createdAt: now,
          updatedAt: now,
        };
      }
      return null;
    },
    upsertPasswordHash: async (identityId, passwordHash, passwordAlgo) => {
      state.upsertCalls.push({ identityId, passwordHash, passwordAlgo });
    },
  };

  const storage: StorageAdapter = {
    users,
    identities,
    credentials,
    verificationTokens: {} as VerificationTokenRepository,
    oauthStates: {} as OAuthStateRepository,
    sessions: {} as SessionRepository,
    connect: async () => undefined,
    disconnect: async () => undefined,
    transaction: async <T>(handler: (storage: StorageAdapter) => Promise<T>) => handler(storage),
  };

  const identityService: IdentityService = {
    findIdentity: async () => null,
    findUserById: users.findById,
    findUserByEmail: users.findByEmail,
    findUserByPhone: users.findByPhone,
    createUser: users.create,
    createIdentity: identities.create,
    touchLastLogin: users.updateLastLoginAt,
  } as unknown as IdentityService;

  const context: ProviderContext = {
    config: {
      appName: 'test-app',
      baseUrl: 'http://localhost:3000',
      routePrefix: '/auth',
      database: {
        provider: 'postgres',
        url: 'postgres://postgres:postgres@localhost:5432/omni_login_kit',
      },
      session: {
        strategy: 'jwt',
        accessTokenTtl: '15m',
        refreshTokenTtl: '30d',
        issuer: 'test',
        audience: 'test',
        secret: 'secret',
      },
      providers: [],
    },
    storage,
    logger: {} as Logger,
    sessionManager: {} as ProviderContext['sessionManager'],
    identityService,
    verificationService: {} as VerificationService,
    passwordService,
  };

  return { context, state };
}

/**
 * PasswordProvider 单元测试。
 */
describe('PasswordProvider', () => {
  /**
   * 测试密码登录成功主流程。
   */
  it('应该允许用户名密码登录成功', async () => {
    const provider = new PasswordProvider(createPasswordProviderConfig());
    const { context, state } = await createPasswordProviderContext();
    await provider.initialize(context);

    const result = await provider.authenticate({
      account: 'demo_user',
      password: '12345678',
    });

    assert.equal(result.userId, 'user-test-id');
    assert.equal(result.identityId, 'identity-test-id');
    assert.equal(result.isNewUser, false);
    assert.deepEqual(result.metadata, { identifierType: 'username' });
    assert.deepEqual(state.touchedUserIds, ['user-test-id']);
  });

  /**
   * 测试错误密码应被拒绝。
   */
  it('应该拒绝错误密码登录', async () => {
    const provider = new PasswordProvider(createPasswordProviderConfig());
    const { context } = await createPasswordProviderContext();
    await provider.initialize(context);

    await assert.rejects(
      async () => {
        await provider.authenticate({
          account: 'demo_user',
          password: 'wrong-password',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'AUTH_CREDENTIALS_001');
        return true;
      },
    );
  });

  /**
   * 测试邮箱账号注册成功。
   */
  it('应该允许邮箱注册成功', async () => {
    const provider = new PasswordProvider(createPasswordProviderConfig());
    const { context, state } = await createPasswordProviderContext();
    await provider.initialize(context);

    const result = await provider.register({
      account: 'new@example.com',
      password: '12345678',
      displayName: '新用户',
    });

    assert.equal(result.isNewUser, true);
    assert.equal(result.userId, 'user-created-1');
    assert.equal(result.identityId, 'identity-created-1');
    assert.deepEqual(result.metadata, { identifierType: 'email' });
    assert.equal(state.createdUsers.length, 1);
    assert.equal(state.createdUsers[0].email, 'new@example.com');
    assert.equal(state.createdIdentities.length, 1);
    assert.equal(state.createdIdentities[0].email, 'new@example.com');
    assert.equal(state.upsertCalls.length, 1);
    assert.equal(state.upsertCalls[0].identityId, 'identity-created-1');
  });

  /**
   * 测试重复用户名注册会失败。
   */
  it('应该拒绝重复用户名注册', async () => {
    const provider = new PasswordProvider(createPasswordProviderConfig());
    const { context } = await createPasswordProviderContext();
    await provider.initialize(context);

    await assert.rejects(
      async () => {
        await provider.register({
          account: 'taken_name',
          password: '12345678',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'USER_USERNAME_001');
        return true;
      },
    );
  });

  /**
   * 测试旧密码正确时可以完成密码重置。
   */
  it('应该允许使用旧密码重置为新密码', async () => {
    const provider = new PasswordProvider(createPasswordProviderConfig());
    const { context, state } = await createPasswordProviderContext();
    await provider.initialize(context);

    await provider.resetPassword({
      account: 'demo_user',
      oldPassword: '12345678',
      newPassword: '87654321',
    });

    assert.equal(state.upsertCalls.length, 1);
    assert.equal(state.upsertCalls[0].identityId, 'identity-test-id');
    assert.equal(state.upsertCalls[0].passwordAlgo, 'scrypt');
    assert.equal(state.upsertCalls[0].passwordHash.includes('87654321'), false);
  });

  /**
   * 测试新旧密码相同时应拒绝重置。
   */
  it('应该拒绝将新密码设置为旧密码', async () => {
    const provider = new PasswordProvider(createPasswordProviderConfig());
    const { context } = await createPasswordProviderContext();
    await provider.initialize(context);

    await assert.rejects(
      async () => {
        await provider.resetPassword({
          account: 'demo_user',
          oldPassword: '12345678',
          newPassword: '12345678',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'AUTH_INPUT_001');
        return true;
      },
    );
  });
});
