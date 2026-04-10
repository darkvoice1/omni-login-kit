import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { WechatProvider, type WechatOAuthGateway, type WechatOAuthProfile } from '../../src/providers/wechat/wechat-provider.js';
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

interface WechatTestState {
  users: UserRecord[];
  identities: IdentityRecord[];
  touchedUserIds: string[];
  createdUsers: UserRecord[];
  createdIdentities: IdentityRecord[];
  consumedStateHashes: string[];
  useInvalidState?: boolean;
}

/**
 * WechatProvider 回调逻辑单元测试。
 */
describe('WechatProvider', () => {
  it('应该在首次登录时创建用户与身份', async () => {
    const state = createWechatTestState();
    const provider = new WechatProvider(
      createWechatProviderConfig(),
      createFakeGateway({
        providerSubject: 'wechat-unionid-001',
        displayName: '王五',
        avatarUrl: 'https://example.com/avatar.png',
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
    assert.equal(state.createdUsers[0].displayName, '王五');
    assert.equal(state.createdIdentities.length, 1);
    assert.equal(state.createdIdentities[0].providerSubject, 'wechat-unionid-001');

    const expectedStateHash = createHash('sha256').update(rawState).digest('hex');
    assert.equal(state.consumedStateHashes[0], expectedStateHash);
  });

  it('应该在已绑定身份时直接登录并不重复建号', async () => {
    const state = createWechatTestState({
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
          providerType: 'wechat',
          providerSubject: 'wechat-unionid-001',
        }),
      ],
    });

    const provider = new WechatProvider(
      createWechatProviderConfig(),
      createFakeGateway({
        providerSubject: 'wechat-unionid-001',
        displayName: '老用户',
      }),
    );

    await provider.initialize(createProviderContext(state));

    const result = await provider.handleCallback({
      code: 'oauth-code-002',
      state: 'raw-state-002',
    });

    assert.equal(result.isNewUser, false);
    assert.equal(result.identityId, 'identity-existing-001');
    assert.equal(state.createdUsers.length, 0);
    assert.equal(state.createdIdentities.length, 0);
    assert.deepEqual(state.touchedUserIds, ['user-existing-001']);
  });

  it('应该在 state 无效时直接失败且不调用网关', async () => {
    const state = createWechatTestState();
    state.useInvalidState = true;

    let gatewayCalled = false;
    const provider = new WechatProvider(
      createWechatProviderConfig(),
      {
        resolveProfileByCode: async () => {
          gatewayCalled = true;
          return {
            providerSubject: 'wechat-openid-004',
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

  it('应该在已绑定身份对应用户不存在时抛错', async () => {
    const state = createWechatTestState({
      identities: [
        createIdentityRecord({
          id: 'identity-missing-user',
          userId: 'user-not-exist',
          providerType: 'wechat',
          providerSubject: 'wechat-unionid-missing-user',
        }),
      ],
    });

    const provider = new WechatProvider(
      createWechatProviderConfig(),
      createFakeGateway({
        providerSubject: 'wechat-unionid-missing-user',
        displayName: '缺失用户',
      }),
    );

    await provider.initialize(createProviderContext(state));

    await assert.rejects(
      async () => {
        await provider.handleCallback({
          code: 'oauth-code-005',
          state: 'raw-state-005',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'AUTH_USER_001');
        return true;
      },
    );
  });

  it('应该在已绑定身份对应用户被禁用时抛错', async () => {
    const state = createWechatTestState({
      users: [
        createUserRecord({
          id: 'user-disabled-001',
          displayName: '被禁用用户',
          status: 'disabled',
        }),
      ],
      identities: [
        createIdentityRecord({
          id: 'identity-disabled-user',
          userId: 'user-disabled-001',
          providerType: 'wechat',
          providerSubject: 'wechat-unionid-disabled-user',
        }),
      ],
    });

    const provider = new WechatProvider(
      createWechatProviderConfig(),
      createFakeGateway({
        providerSubject: 'wechat-unionid-disabled-user',
        displayName: '被禁用用户',
      }),
    );

    await provider.initialize(createProviderContext(state));

    await assert.rejects(
      async () => {
        await provider.handleCallback({
          code: 'oauth-code-006',
          state: 'raw-state-006',
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'AUTH_USER_002');
        return true;
      },
    );
  });
});

/**
 * 创建 WechatProvider 测试上下文。
 */
function createProviderContext(state: WechatTestState): ProviderContext {
  const now = new Date();

  const usersRepo: UserRepository = {
    findById: async (userId) => state.users.find((user) => user.id === userId) ?? null,
    findByEmail: async () => null,
    findByPhone: async () => null,
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
      appName: 'wechat-provider-test',
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
 * 生成测试用微信网关。
 */
function createFakeGateway(profile: WechatOAuthProfile): WechatOAuthGateway {
  return {
    resolveProfileByCode: async () => profile,
  };
}

/**
 * 创建测试用微信 Provider 配置。
 */
function createWechatProviderConfig() {
  return {
    type: 'wechat' as const,
    enabled: true,
    clientId: 'wechat-client-id',
    clientSecret: 'wechat-client-secret',
    scope: ['snsapi_login'],
  };
}

/**
 * 创建测试态对象。
 */
function createWechatTestState(input?: {
  users?: UserRecord[];
  identities?: IdentityRecord[];
}): WechatTestState {
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
    providerType: 'wechat',
    stateHash: 'state-hash-test',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
  };
}
