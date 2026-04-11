import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createAuthRouter } from '../../src/adapters/express/create-auth-router.js';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import type { OmniAuth } from '../../src/core/omni-auth.js';
import type { CredentialAuthSuccessResult } from '../../src/core/omni-auth.js';

describe('createAuthRouter', () => {
  let serverUrl = '';
  let closeServer: (() => Promise<void>) | undefined;
  const loginCalls: Array<{
    providerType: string;
    input: Record<string, unknown>;
    runtimeContext?: Record<string, unknown>;
  }> = [];
  const listIdentityCalls: string[] = [];
  const unbindCalls: Array<{ accessToken: string; identityId: string }> = [];
  const bindAuthorizeCalls: Array<{ providerType: string; accessToken: string }> = [];

  const fakeAuth = {
    config: {
      appName: 'router-test-app',
    },
    listEnabledProviders: () => [],
    listMyIdentities: async (accessToken: string) => {
      listIdentityCalls.push(accessToken);
      return [
        {
          id: 'identity-1',
          userId: 'user-1',
          providerType: 'password',
          providerSubject: 'demo@example.com',
          metadata: {},
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ];
    },
    unbindIdentity: async (accessToken: string, identityId: string) => {
      unbindCalls.push({ accessToken, identityId });
      return { ok: true };
    },
    requestEmailCode: async () => ({ ok: true }),
    requestSmsCode: async () => ({ ok: true }),
    requestEmailMagicLink: async (input: Record<string, unknown>) => ({
      ok: true,
      metadata: input,
    }),
    registerWithPassword: async () => ({
      userId: 'u',
      identityId: 'i',
      isNewUser: true,
    }),
    authenticateWithCredentials: async (
      providerType: string,
      input: Record<string, unknown>,
      runtimeContext?: Record<string, unknown>,
    ): Promise<CredentialAuthSuccessResult> => {
      loginCalls.push({ providerType, input, runtimeContext });
      return {
        userId: 'user-1',
        identityId: 'identity-1',
        isNewUser: false,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        sessionId: 'session-1',
      };
    },
    logout: async () => ({ ok: true }),
    createAuthorizationUrl: async () => 'http://localhost/oauth',
    createBindAuthorizationUrl: async (providerType: string, accessToken: string) => {
      bindAuthorizeCalls.push({ providerType, accessToken });
      return `http://localhost/oauth-bind/${providerType}`;
    },
    handleOAuthCallback: async () => ({
      userId: 'u',
      identityId: 'i',
      isNewUser: false,
    }),
    handleOAuthBindCallback: async () => ({
      userId: 'user-1',
      identityId: 'identity-wecom-1',
      isNewUser: false,
      metadata: {
        bindAction: 'created',
      },
    }),
  } as unknown as OmniAuth;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(fakeAuth));

    await new Promise<void>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => {
        const address = instance.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
        closeServer = async () => {
          await new Promise<void>((done) => instance.close(() => done()));
        };
        resolve();
      });
    });
  });

  after(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('应该暴露请求邮箱魔法链接接口', async () => {
    const response = await fetch(`${serverUrl}/auth/email-magic-link/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'demo@example.com' }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; metadata: Record<string, unknown> };
    assert.equal(body.ok, true);
    assert.equal(body.metadata.email, 'demo@example.com');
  });

  it('应该在回调时消费 email/token 并触发登录', async () => {
    loginCalls.length = 0;

    const response = await fetch(
      `${serverUrl}/auth/email-magic-link/callback?email=demo%40example.com&token=magic-token`,
      {
        headers: {
          'user-agent': 'router-test-agent',
        },
      },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { userId: string; sessionId: string };
    assert.equal(body.userId, 'user-1');
    assert.equal(body.sessionId, 'session-1');

    assert.equal(loginCalls.length, 1);
    assert.equal(loginCalls[0].providerType, 'email_magic_link');
    assert.deepEqual(loginCalls[0].input, {
      email: 'demo@example.com',
      token: 'magic-token',
    });
    assert.equal(loginCalls[0].runtimeContext?.userAgent, 'router-test-agent');
  });

  it('应该在回调参数缺失时返回 AUTH_INPUT_001', async () => {
    const response = await fetch(`${serverUrl}/auth/email-magic-link/callback?email=demo%40example.com`);

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'AUTH_INPUT_001');
    assert.equal(body.error.message.includes('token'), true);
  });

  it('应该要求 /identities 接口携带 Bearer Token', async () => {
    const response = await fetch(`${serverUrl}/auth/identities`);

    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'AUTH_INPUT_001');
  });

  it('应该返回当前用户绑定身份列表', async () => {
    listIdentityCalls.length = 0;

    const response = await fetch(`${serverUrl}/auth/identities`, {
      headers: {
        authorization: 'Bearer access-token-1',
      },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { identities: Array<{ id: string }> };
    assert.equal(Array.isArray(body.identities), true);
    assert.equal(body.identities.length, 1);
    assert.equal(body.identities[0].id, 'identity-1');
    assert.equal(listIdentityCalls[0], 'access-token-1');
  });

  it('应该支持 OAuth 绑定授权地址生成并重定向', async () => {
    bindAuthorizeCalls.length = 0;

    const response = await fetch(`${serverUrl}/auth/oauth/wecom/bind/authorize`, {
      headers: {
        authorization: 'Bearer bind-token-1',
      },
      redirect: 'manual',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost/oauth-bind/wecom');
    assert.equal(bindAuthorizeCalls.length, 1);
    assert.equal(bindAuthorizeCalls[0].providerType, 'wecom');
    assert.equal(bindAuthorizeCalls[0].accessToken, 'bind-token-1');
  });

  it('应该支持 OAuth 绑定回调接口', async () => {
    const response = await fetch(`${serverUrl}/auth/oauth/wecom/bind/callback?code=abc&state=xyz`);

    assert.equal(response.status, 200);
    const body = (await response.json()) as { userId: string; identityId: string; metadata?: Record<string, unknown> };
    assert.equal(body.userId, 'user-1');
    assert.equal(body.identityId, 'identity-wecom-1');
    assert.equal(body.metadata?.bindAction, 'created');
  });

  it('应该支持解绑身份接口', async () => {
    unbindCalls.length = 0;

    const response = await fetch(`${serverUrl}/auth/identities/identity-1`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer access-token-2',
      },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    assert.equal(unbindCalls.length, 1);
    assert.equal(unbindCalls[0].accessToken, 'access-token-2');
    assert.equal(unbindCalls[0].identityId, 'identity-1');
  });

  it('应该透传 OmniAuthError 的状态码和错误码', async () => {
    const errorAuth = {
      ...fakeAuth,
      requestEmailMagicLink: async () => {
        throw new OmniAuthError({
          code: 'AUTH_INPUT_001',
          message: 'bad input',
          statusCode: 422,
        });
      },
    } as unknown as OmniAuth;

    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(errorAuth));

    const tempServer = await new Promise<import('node:http').Server>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    const tempAddress = tempServer.address() as AddressInfo;
    const tempUrl = `http://127.0.0.1:${tempAddress.port}`;

    const response = await fetch(`${tempUrl}/auth/email-magic-link/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: '' }),
    });

    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'AUTH_INPUT_001');

    await new Promise<void>((resolve) => tempServer.close(() => resolve()));
  });
});
