import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { Pool } from 'pg';
import { createAuthRouter, OmniAuth, PostgresStorageAdapter } from '../../src/index.js';
import type { OmniAuthConfig, ProviderType } from '../../src/types/auth-config.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/omni_login_kit';

const testAuthConfig: OmniAuthConfig = {
  appName: 'oauth-router-test',
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
    issuer: 'oauth-router-test',
    audience: 'integration-test',
    secret: 'integration-secret',
  },
  providers: [
    {
      type: 'wecom',
      enabled: true,
      clientId: 'wecom-client-id',
      clientSecret: 'wecom-client-secret',
      scope: ['snsapi_login'],
    },
    {
      type: 'feishu',
      enabled: true,
      clientId: 'feishu-client-id',
      clientSecret: 'feishu-client-secret',
      scope: ['contact:user.base:readonly'],
    },
    {
      type: 'wechat',
      enabled: true,
      clientId: 'wechat-client-id',
      clientSecret: 'wechat-client-secret',
      scope: ['snsapi_login'],
    },
  ],
};

const PROVIDER_AUTH_ENDPOINTS: Record<'wecom' | 'feishu' | 'wechat', string> = {
  wecom: 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect',
  feishu: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  wechat: 'https://open.weixin.qq.com/connect/qrconnect',
};

/**
 * OAuth 路由集成测试。
 */
describe('OAuth 路由集成测试', () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const storage = new PostgresStorageAdapter(TEST_DATABASE_URL);
  const auth = new OmniAuth({ config: testAuthConfig, storage });
  let server: import('node:http').Server | undefined;
  let serverUrl = '';
  const originalFetch = globalThis.fetch;

  before(async () => {
    let migrationSql = await readFile('migrations/0001_init.sql', 'utf8');
    migrationSql = migrationSql.replace(/^\uFEFF/, '');
    await pool.query(migrationSql);

    // 关键步骤：先挂载 mock，再初始化 auth，确保 Provider 内部网关捕获的是 mock fetch。
    (globalThis as { fetch: typeof fetch }).fetch = createMockFetch(() => serverUrl, originalFetch);

    await auth.initialize();

    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(auth));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server?.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await cleanupOAuthTestData(pool);

    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;

    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }

    await auth.shutdown();
    await pool.end();
  });

  it('应该为三方登录生成授权跳转并写入 state', async () => {
    for (const providerType of ['wecom', 'feishu', 'wechat'] as const) {
      const { state, location } = await requestAuthorize(serverUrl, providerType);
      assert.equal(location.startsWith(PROVIDER_AUTH_ENDPOINTS[providerType]), true);

      const stateHash = createHash('sha256').update(state).digest('hex');
      const rows = await pool.query(
        `
        SELECT *
        FROM oauth_states
        WHERE provider_type = $1 AND state_hash = $2
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [providerType, stateHash],
      );

      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].consumed_at, null);
    }
  });

  it('应该通过 callback 完成三方登录并创建身份', async () => {
    const cases: Array<{
      providerType: 'wecom' | 'feishu' | 'wechat';
      code: string;
      expectedSubject: string;
    }> = [
      {
        providerType: 'wecom',
        code: 'code-wecom-001',
        expectedSubject: 'it-wecom-openid-001',
      },
      {
        providerType: 'feishu',
        code: 'code-feishu-001',
        expectedSubject: 'it-feishu-openid-001',
      },
      {
        providerType: 'wechat',
        code: 'code-wechat-001',
        expectedSubject: 'it-wechat-unionid-001',
      },
    ];

    for (const item of cases) {
      const { state } = await requestAuthorize(serverUrl, item.providerType);
      const callbackResponse = await fetch(
        `${serverUrl}/auth/oauth/${item.providerType}/callback?code=${encodeURIComponent(item.code)}&state=${encodeURIComponent(state)}`,
      );

      assert.equal(callbackResponse.status, 200);
      const body = (await callbackResponse.json()) as {
        userId: string;
        identityId: string;
        isNewUser: boolean;
      };

      assert.equal(typeof body.userId, 'string');
      assert.equal(typeof body.identityId, 'string');
      assert.equal(body.isNewUser, true);

      const identityRows = await pool.query('SELECT * FROM identities WHERE id = $1', [body.identityId]);
      assert.equal(identityRows.rowCount, 1);
      assert.equal(identityRows.rows[0].provider_type, item.providerType);
      assert.equal(identityRows.rows[0].provider_subject, item.expectedSubject);

      const userRows = await pool.query('SELECT * FROM users WHERE id = $1', [body.userId]);
      assert.equal(userRows.rowCount, 1);
      assert.equal(userRows.rows[0].status, 'active');
    }
  });

  it('应该拒绝重复消费同一个 state', async () => {
    const { state } = await requestAuthorize(serverUrl, 'wecom');

    const firstResponse = await fetch(
      `${serverUrl}/auth/oauth/wecom/callback?code=${encodeURIComponent('code-wecom-002')}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(firstResponse.status, 200);

    const secondResponse = await fetch(
      `${serverUrl}/auth/oauth/wecom/callback?code=${encodeURIComponent('code-wecom-003')}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(secondResponse.status, 400);

    const body = (await secondResponse.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'OAUTH_STATE_002');
  });

  it('应该拒绝无效 state', async () => {
    const response = await fetch(
      `${serverUrl}/auth/oauth/feishu/callback?code=${encodeURIComponent('code-feishu-002')}&state=${encodeURIComponent('invalid-state')}`,
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'OAUTH_STATE_002');
  });
});

/**
 * 请求授权地址并提取回调 state。
 */
async function requestAuthorize(
  serverUrl: string,
  providerType: 'wecom' | 'feishu' | 'wechat',
): Promise<{ state: string; location: string }> {
  const response = await fetch(`${serverUrl}/auth/oauth/${providerType}/authorize`, {
    method: 'GET',
    redirect: 'manual',
  });

  assert.equal(response.status, 302);
  const location = response.headers.get('location');
  assert.equal(typeof location, 'string');
  assert.equal((location ?? '').length > 0, true);

  const state = new URL(location as string).searchParams.get('state');
  assert.equal(typeof state, 'string');
  assert.equal((state ?? '').length > 0, true);

  return {
    state: state as string,
    location: location as string,
  };
}

/**
 * 创建第三方网关请求 mock。
 */
function createMockFetch(getServerUrl: () => string, originalFetch: typeof fetch): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const urlString = readUrl(input);
    const serverUrl = getServerUrl();

    // 本地路由请求走真实服务端。
    if (serverUrl && urlString.startsWith(serverUrl)) {
      return originalFetch(input as RequestInfo | URL, init);
    }

    const url = new URL(urlString);

    if (url.host === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/gettoken') {
      return jsonResponse({
        errcode: 0,
        access_token: 'it-wecom-access-token',
      });
    }

    if (url.host === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/user/getuserinfo') {
      return jsonResponse({
        errcode: 0,
        OpenId: 'it-wecom-openid-001',
        UserId: 'it-wecom-user-001',
      });
    }

    if (url.host === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/user/get') {
      return jsonResponse({
        errcode: 0,
        userid: 'it-wecom-user-001',
        name: 'IT WeCom User',
        email: 'it.wecom.oauth@example.com',
        mobile: '13800001111',
        avatar: 'https://example.com/it-wecom-avatar.png',
      });
    }

    if (url.host === 'open.feishu.cn' && url.pathname === '/open-apis/authen/v2/oauth/token') {
      return jsonResponse({
        code: 0,
        data: {
          access_token: 'it-feishu-access-token',
        },
      });
    }

    if (url.host === 'open.feishu.cn' && url.pathname === '/open-apis/authen/v1/user_info') {
      return jsonResponse({
        code: 0,
        data: {
          open_id: 'it-feishu-openid-001',
          user_id: 'it-feishu-user-001',
          name: 'IT Feishu User',
          email: 'it.feishu.oauth@example.com',
          mobile: '13900002222',
          avatar_url: 'https://example.com/it-feishu-avatar.png',
        },
      });
    }

    if (url.host === 'api.weixin.qq.com' && url.pathname === '/sns/oauth2/access_token') {
      return jsonResponse({
        access_token: 'it-wechat-access-token',
        openid: 'it-wechat-openid-001',
        unionid: 'it-wechat-unionid-001',
        scope: 'snsapi_login',
      });
    }

    if (url.host === 'api.weixin.qq.com' && url.pathname === '/sns/userinfo') {
      return jsonResponse({
        openid: 'it-wechat-openid-001',
        unionid: 'it-wechat-unionid-001',
        nickname: 'IT Wechat User',
        headimgurl: 'https://example.com/it-wechat-avatar.png',
      });
    }

    throw new Error(`未命中 mock fetch：${urlString}`);
  };
}

/**
 * 清理 OAuth 路由测试写入的数据。
 */
async function cleanupOAuthTestData(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM oauth_states WHERE provider_type IN ('wecom', 'feishu', 'wechat')");

  const identityRows = await pool.query<{ id: string; user_id: string }>(
    `
    SELECT id, user_id
    FROM identities
    WHERE provider_type IN ('wecom', 'feishu', 'wechat')
      AND provider_subject LIKE 'it-%'
    `,
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

/**
 * 统一读取 fetch 入参中的 URL 字符串。
 */
function readUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

/**
 * 构造 JSON Response。
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

