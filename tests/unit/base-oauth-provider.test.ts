import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { BaseOAuthProvider } from '../../src/providers/base/base-oauth-provider.js';
import type { ProviderAuthResult, ProviderContext } from '../../src/providers/base/types.js';
import type { OAuthStateRecord } from '../../src/types/entities.js';

/**
 * 用于测试 BaseOAuthProvider 回调校验行为的最小实现。
 */
class TestOAuthProvider extends BaseOAuthProvider {
  constructor() {
    super('Test OAuth Provider', 'wecom', {
      type: 'wecom',
      enabled: true,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
  }

  protected getAuthorizationEndpoint(): string {
    return 'https://example.com/oauth/authorize';
  }

  protected getDefaultScope(): string[] {
    return ['snsapi_login'];
  }

  /**
   * 关键步骤：调用基类的 code/state 校验与 state 消费逻辑。
   */
  async handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult> {
    const code = this.ensureCallbackCode(input.code);
    const consumedState = await this.consumeCallbackState(input.state);

    return {
      userId: 'user_test_001',
      identityId: 'identity_test_001',
      isNewUser: false,
      metadata: {
        code,
        consumedStateId: consumedState.id,
      },
    };
  }
}

describe('BaseOAuthProvider 回调 state/code 校验', () => {
  it('应该在 code 缺失时抛出 OAUTH_CODE_001，并且不消费 state', async () => {
    let consumeCalled = false;
    const provider = new TestOAuthProvider();
    await provider.initialize(
      createProviderContext({
        consumeByStateHash: async () => {
          consumeCalled = true;
          return null;
        },
      }),
    );

    await assert.rejects(
      async () => {
        await provider.handleCallback({ code: '   ', state: 'raw-state' });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'OAUTH_CODE_001');
        return true;
      },
    );

    assert.equal(consumeCalled, false);
  });

  it('应该在 state 缺失时抛出 OAUTH_STATE_001', async () => {
    const provider = new TestOAuthProvider();
    await provider.initialize(
      createProviderContext({
        consumeByStateHash: async () => null,
      }),
    );

    await assert.rejects(
      async () => {
        await provider.handleCallback({ code: 'oauth-code-001', state: '   ' });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'OAUTH_STATE_001');
        return true;
      },
    );
  });

  it('应该在 state 无效或已过期时抛出 OAUTH_STATE_002', async () => {
    let capturedStateHash: string | undefined;
    const provider = new TestOAuthProvider();
    await provider.initialize(
      createProviderContext({
        consumeByStateHash: async (stateHash) => {
          capturedStateHash = stateHash;
          return null;
        },
      }),
    );

    const rawState = 'raw-state-xyz';
    await assert.rejects(
      async () => {
        await provider.handleCallback({ code: 'oauth-code-001', state: rawState });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'OAUTH_STATE_002');
        return true;
      },
    );

    const expectedHash = createHash('sha256').update(rawState).digest('hex');
    assert.equal(capturedStateHash, expectedHash);
  });

  it('应该在 code/state 有效时消费 state 并继续后续流程', async () => {
    const consumedRecord = createOAuthStateRecord('state_record_001');

    const provider = new TestOAuthProvider();
    await provider.initialize(
      createProviderContext({
        consumeByStateHash: async () => consumedRecord,
      }),
    );

    const result = await provider.handleCallback({ code: '  oauth-code-001  ', state: 'raw-state-xyz' });

    assert.equal(result.userId, 'user_test_001');
    assert.equal(result.identityId, 'identity_test_001');
    assert.equal(result.isNewUser, false);
    assert.equal(result.metadata?.code, 'oauth-code-001');
    assert.equal(result.metadata?.consumedStateId, consumedRecord.id);
  });
});

/**
 * 创建最小可用的 ProviderContext。
 */
function createProviderContext(input: {
  consumeByStateHash: (stateHash: string, consumedAt: Date) => Promise<OAuthStateRecord | null>;
}): ProviderContext {
  return {
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
        issuer: 'test-issuer',
        audience: 'test-audience',
        secret: 'test-secret',
      },
      providers: [],
    },
    storage: {
      oauthStates: {
        create: async () => {
          throw new Error('not implemented in this test');
        },
        consumeByStateHash: input.consumeByStateHash,
      },
    } as unknown as ProviderContext['storage'],
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
 * 生成测试用 OAuthStateRecord。
 */
function createOAuthStateRecord(id: string): OAuthStateRecord {
  return {
    id,
    providerType: 'wecom',
    stateHash: 'state_hash_test',
    redirectTo: '/dashboard',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
  };
}

