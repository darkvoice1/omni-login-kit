import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { FeishuProvider, type FeishuOAuthGateway, type FeishuOAuthProfile } from '../../src/providers/feishu/feishu-provider.js';
import type { ProviderContext } from '../../src/providers/base/types.js';
import type {
  CredentialRepository,
  IdentityRepository,
  OAuthStateRepository,
  SessionRepository,
  StorageAdapter,
  UserRepository,
  VerificationTokenRepository,
} from '../../src/storage/storage-adapter.js';
import type { IdentityRecord, OAuthStateRecord, UserRecord } from '../../src/types/entities.js';

interface FeishuTestState {
  users: UserRecord[];
  identities: IdentityRecord[];
  touchedUserIds: string[];
  createdUsers: UserRecord[];
  createdIdentities: IdentityRecord[];
  consumedStateHashes: string[];
  useInvalidState?: boolean;
}

/**
 * FeishuProvider 回调逻辑单元测试。
 */
describe('FeishuProvider', () => {
  it('应该在首次登录时创建用户与身份', async () => {
    const state = createFeishuTestState();
    const provider = new FeishuProvider(
      createFeishuProviderConfig(),
      createFakeGateway({
        providerSubject: 'feishu-openid-001',
        displayName: '李四',
        email: 'lisi@example.com',
      }),
    );

    await provider.initialize(createProviderContext(state));

    const rawState = 'raw-state-001';
    const result = await provider.handleCallback({
      code: 'oauth-code-001',
      state: rawState,
    });

    assert.equal(result.isNewUser, true);
    assert.equal(result.metadata?.linkedBy, 'new_user');
    assert.equal(state.createdUsers.length, 1);
    assert.equal(state.createdUsers[0].email, 'lisi@example.com');
    assert.equal(state.createdIdentities.length, 1);
    assert.equal(state.createdIdentities[0].providerSubject, 'feishu-openid-001');

    const expectedStateHash = createHash('sha256').update(rawState).digest('hex');
    assert.equal(state.consumedStateHashes[0], expectedStateHash);
  });

  it('应该在已绑定身份时直接登录并不重复建号', async () => {
    const state = createFeishuTestState({
      users: [
        createUserRecord({
          id: 'user-existing-001',
          displayName: '老用户',
        }),
      ],
      identities: [
        createIdentityRecord({
          id: 'identity-existing-001',
          userId: 'user-existing-001',
          providerType: 'feishu',
          providerSubject: 'feishu-openid-001',
        }),
      ],
    });

    const provider = new FeishuProvider(
      createFeishuProviderConfig(),
      createFakeGateway({
        providerSubject: 'feishu-openid-001',
        displayName: '老用户',
      }),
    );

    await provider.initialize(createProviderContext(state));

    const result = await provider.handleCallback({
      code: 'oauth-code-001',
      state: 'raw-state-001',
    });

    assert.equal(result.isNewUser, false);
    assert.equal(result.identityId, 'identity-existing-001');
    assert.equal(state.createdUsers.length, 0);
    assert.equal(state.createdIdentities.length, 0);
    assert.deepEqual(state.touchedUserIds, ['user-existing-001']);
  });

  it('应该在身份不存在时按邮箱绑定已有用户', async () => {
    const state = createFeishuTestState({
      users: [
        createUserRecord({
          id: 'user-email-001',
          displayName: '邮箱用户',
          email: 'bind@example.com',
        }),
      ],
    });

    const provider = new FeishuProvider(
      createFeishuProviderConfig(),
      createFakeGateway({
        providerSubject: 'feishu-openid-002',
        displayName: '邮箱用户',
        email: 'bind@example.com',
      }),
    );

    await provider.initialize(createProviderContext(state));

    const result = await provider.handleCallback({
      code: 'oauth-code-002',
      state: 'raw-state-002',
    });

    assert.equal(result.isNewUser, false);
    assert.equal(result.userId, 'user-email-001');
    assert.equal(result.metadata?.linkedBy, 'email');
    assert.equal(state.createdUsers.length, 0);
    assert.equal(state.createdIdentities.length, 1);
    assert.equal(state.createdIdentities[0].userId, 'user-email-001');
  });

  it('应该在邮箱和手机号命中不同用户时抛绑定冲突错误', async () => {
    const state = createFeishuTestState({
      users: [
        createUserRecord({
          id: 'user-email-001',
          displayName: '邮箱用户',
          email: 'conflict@example.com',
        }),
        createUserRecord({
          id: 'user-phone-001',
          displayName: '手机用户',
          phone: '13800001111',
        }),
      ],
    });

    const provider = new FeishuProvider(
      createFeishuProviderConfig(),
      createFakeGateway({
        providerSubject: 'feishu-openid-conflict',
        displayName: '冲突用户',
        email: 'conflict@example.com',
        phone: '13800001111',
      }),
    );

    await provider.initialize(createProviderContext(state));

    await assert.rejects(
      async () => {
        await provider.handleCallback({
          code: 'oauth-code-003',
          state: 'raw-state-003',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'OAUTH_BINDING_001');
        return true;
      },
    );
  });

  it('应该在 state 无效时直接失败且不调用网关', async () => {
    const state = createFeishuTestState();
    state.useInvalidState = true;

    let gatewayCalled = false;
    const provider = new FeishuProvider(
      createFeishuProviderConfig(),
      {
        resolveProfileByCode: async () => {
          gatewayCalled = true;
          return {
            providerSubject: 'feishu-openid-004',
            displayName: '无效状态用户',
          };
        },
      },
    );

    await provider.initialize(createProviderContext(state));

    await assert.rejects(
      async () => {
        await provider.handleCallback({
          code: 'oauth-code-004',
          state: 'raw-state-004',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'OAUTH_STATE_002');
        return true;
      },
    );

    assert.equal(gatewayCalled, false);
  });
});

/**
 * 创建 FeishuProvider 测试上下文。
 */
function createProviderContext(state: FeishuTestState): ProviderContext {
  const now = new Date();

  const usersRepo: UserRepository = {
    findById: async (userId) => state.users.find((user) => user.id === userId) ?? null,
    findByEmail: async (email) => state.users.find((user) => user.email === email) ?? null,
    findByPhone: async (phone) => state.users.find((user) => user.phone === phone) ?? null,
    create: async (input) => {
      const created = createUserRecord({
        id: `user-created-${state.createdUsers.length + 1}`,
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
        avatarUrl: input.avatarUrl,
        status: input.status,
      });
      state.users.push(created);
      state.createdUsers.push(created);
      return created;
    },
    updateLastLoginAt: async (userId) => {
      state.touchedUserIds.push(userId);
      const target = state.users.find((user) => user.id === userId);
      if (target) {
        target.lastLoginAt = now;
      }
    },
  };

  const identitiesRepo: IdentityRepository = {
    findByProvider: async (providerType, providerSubject) =>
      state.identities.find(
        (identity) => identity.providerType === providerType && identity.providerSubject === providerSubject,
      ) ?? null,
    findPasswordIdentityByIdentifier: async () => null,
    create: async (input) => {
      const created = createIdentityRecord({
        id: `identity-created-${state.createdIdentities.length + 1}`,
        userId: input.userId,
        providerType: input.providerType,
        providerSubject: input.providerSubject,
        email: input.email,
        phone: input.phone,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl,
        metadata: input.metadata ?? {},
      });
      state.identities.push(created);
      state.createdIdentities.push(created);
      return created;
    },
    listByUserId: async (userId) => state.identities.filter((identity) => identity.userId === userId),
  };

  const oauthStatesRepo: OAuthStateRepository = {
    create: async () => createOAuthStateRecord('oauth-state-created-001'),
    consumeByStateHash: async (stateHash) => {
      state.consumedStateHashes.push(stateHash);
      if (state.useInvalidState) {
        return null;
      }

      return createOAuthStateRecord('oauth-state-consumed-001');
    },
  };

  const storage: StorageAdapter = {
    users: usersRepo,
    identities: identitiesRepo,
    credentials: {} as CredentialRepository,
    verificationTokens: {} as VerificationTokenRepository,
    oauthStates: oauthStatesRepo,
    sessions: {} as SessionRepository,
    connect: async () => undefined,
    disconnect: async () => undefined,
    transaction: async <T>(handler: (storage: StorageAdapter) => Promise<T>) => handler(storage),
  };

  return {
    config: {
      appName: 'feishu-provider-test',
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
        secret: 'test-secret',
      },
      providers: [],
    },
    storage,
    logger: {
      debug: (_message: string, _meta?: Record<string, unknown>) => undefined,
      info: (_message: string, _meta?: Record<string, unknown>) => undefined,
      warn: (_message: string, _meta?: Record<string, unknown>) => undefined,
      error: (_message: string, _meta?: Record<string, unknown>) => undefined,
    },
    sessionManager: {} as ProviderContext['sessionManager'],
    identityService: {} as ProviderContext['identityService'],
    verificationService: {} as ProviderContext['verificationService'],
    passwordService: {} as ProviderContext['passwordService'],
    messageSenderRegistry: {} as ProviderContext['messageSenderRegistry'],
  };
}

/**
 * 生成测试用飞书网关。
 */
function createFakeGateway(profile: FeishuOAuthProfile): FeishuOAuthGateway {
  return {
    resolveProfileByCode: async () => profile,
  };
}

/**
 * 创建测试用飞书 Provider 配置。
 */
function createFeishuProviderConfig() {
  return {
    type: 'feishu' as const,
    enabled: true,
    clientId: 'feishu-client-id',
    clientSecret: 'feishu-client-secret',
    scope: ['contact:user.base:readonly'],
  };
}

/**
 * 创建测试态对象。
 */
function createFeishuTestState(input?: {
  users?: UserRecord[];
  identities?: IdentityRecord[];
}): FeishuTestState {
  return {
    users: [...(input?.users ?? [])],
    identities: [...(input?.identities ?? [])],
    touchedUserIds: [],
    createdUsers: [],
    createdIdentities: [],
    consumedStateHashes: [],
    useInvalidState: false,
  };
}

/**
 * 生成测试用用户记录。
 */
function createUserRecord(input: {
  id: string;
  displayName: string;
  status?: 'active' | 'disabled' | 'pending';
  email?: string;
  phone?: string;
  avatarUrl?: string;
}): UserRecord {
  const now = new Date();
  return {
    id: input.id,
    displayName: input.displayName,
    status: input.status ?? 'active',
    email: input.email,
    phone: input.phone,
    avatarUrl: input.avatarUrl,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 生成测试用身份记录。
 */
function createIdentityRecord(input: {
  id: string;
  userId: string;
  providerType: string;
  providerSubject: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}): IdentityRecord {
  const now = new Date();
  return {
    id: input.id,
    userId: input.userId,
    providerType: input.providerType,
    providerSubject: input.providerSubject,
    email: input.email,
    phone: input.phone,
    nickname: input.nickname,
    avatarUrl: input.avatarUrl,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 生成测试用 OAuth state 记录。
 */
function createOAuthStateRecord(id: string): OAuthStateRecord {
  return {
    id,
    providerType: 'feishu',
    stateHash: 'state-hash-test',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
  };
}
