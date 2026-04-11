import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { WecomProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

interface WecomResolveProfileInput {
  code: string;
  clientId: string;
  clientSecret: string;
}

export interface WecomOAuthProfile {
  providerSubject: string;
  displayName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface WecomOAuthGateway {
  resolveProfileByCode(input: WecomResolveProfileInput): Promise<WecomOAuthProfile>;
}

interface WecomTokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
}

interface WecomUserIdentityResponse {
  errcode?: number;
  errmsg?: string;
  UserId?: string;
  OpenId?: string;
}

interface WecomUserDetailResponse {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  avatar?: string;
  email?: string;
  mobile?: string;
}

/**
 * 默认的企业微信 OAuth 网关实现。
 *
 * 作用：封装“用 code 换用户信息”的外部请求细节，便于单测时注入 fake。
 */
class DefaultWecomOAuthGateway implements WecomOAuthGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async resolveProfileByCode(input: WecomResolveProfileInput): Promise<WecomOAuthProfile> {
    const accessToken = await this.fetchAccessToken(input.clientId, input.clientSecret);
    const identity = await this.fetchUserIdentity(accessToken, input.code);

    const providerSubject = identity.OpenId ?? identity.UserId;
    if (!providerSubject) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_PROFILE_001,
        message: '企业微信 OAuth 回调未返回可用用户标识',
        statusCode: 502,
      });
    }

    const detail = identity.UserId ? await this.fetchUserDetail(accessToken, identity.UserId) : null;

    return {
      providerSubject,
      displayName: detail?.name ?? identity.UserId ?? identity.OpenId ?? 'WeCom User',
      email: detail?.email,
      phone: detail?.mobile,
      avatarUrl: detail?.avatar,
      metadata: {
        openId: identity.OpenId,
        userId: identity.UserId,
      },
    };
  }

  /**
   * 拉取企业微信 access_token。
   */
  private async fetchAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
    url.searchParams.set('corpid', clientId);
    url.searchParams.set('corpsecret', clientSecret);

    const payload = await this.requestJson<WecomTokenResponse>(url.toString(), {
      code: ERROR_CODES.OAUTH_TOKEN_001,
      message: '企业微信 OAuth 获取 access_token 失败',
    });

    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_TOKEN_001,
        message: '企业微信 OAuth access_token 响应缺失',
        statusCode: 502,
      });
    }

    return payload.access_token.trim();
  }

  /**
   * 通过授权 code 获取用户身份主键（UserId/OpenId）。
   */
  private async fetchUserIdentity(accessToken: string, code: string): Promise<WecomUserIdentityResponse> {
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('code', code);

    return this.requestJson<WecomUserIdentityResponse>(url.toString(), {
      code: ERROR_CODES.OAUTH_PROFILE_001,
      message: '企业微信 OAuth 获取用户身份失败',
    });
  }

  /**
   * 用 UserId 获取更多用户资料（昵称、邮箱、手机号等）。
   */
  private async fetchUserDetail(accessToken: string, userId: string): Promise<WecomUserDetailResponse | null> {
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/user/get');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('userid', userId);

    return this.requestJson<WecomUserDetailResponse>(url.toString(), {
      code: ERROR_CODES.OAUTH_PROFILE_001,
      message: '企业微信 OAuth 获取用户资料失败',
    });
  }

  /**
   * 发起 GET 请求并执行企业微信 errcode 语义校验。
   */
  private async requestJson<T extends { errcode?: number; errmsg?: string }>(
    url: string,
    error: { code: typeof ERROR_CODES[keyof typeof ERROR_CODES]; message: string },
  ): Promise<T> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as T;
      if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
        throw new OmniAuthError({
          code: error.code,
          message: `${error.message}：${payload.errmsg ?? `errcode=${payload.errcode}`}`,
          statusCode: 502,
        });
      }

      return payload;
    } catch (cause) {
      if (cause instanceof OmniAuthError) {
        throw cause;
      }

      throw new OmniAuthError({
        code: error.code,
        message: error.message,
        statusCode: 502,
        cause,
      });
    }
  }
}

/**
 * 企业微信 OAuth Provider。
 */
export class WecomProvider extends BaseOAuthProvider {
  private readonly providerConfig: WecomProviderConfig;
  private readonly oauthGateway: WecomOAuthGateway;

  constructor(config: WecomProviderConfig, oauthGateway?: WecomOAuthGateway) {
    super('WeCom Provider', 'wecom', config);
    this.providerConfig = config;
    this.oauthGateway = oauthGateway ?? new DefaultWecomOAuthGateway();
  }

  protected getAuthorizationEndpoint(): string {
    return 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect';
  }

  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['snsapi_login'];
  }

  /**
   * 处理企业微信 OAuth 回调。
   */
  async handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult> {
    const code = this.ensureCallbackCode(input.code);
    await this.consumeCallbackState(input.state);

    const profile = await this.oauthGateway.resolveProfileByCode({
      code,
      clientId: this.providerConfig.clientId,
      clientSecret: this.providerConfig.clientSecret,
    });

    return this.completeOAuthLoginWithProfile(profile, {
      enableContactBinding: true,
      bindingConflictMessage: '企业微信账号绑定冲突：邮箱与手机号命中不同用户',
    });
  }

  /**
   * 处理“已登录用户绑定企业微信账号”回调。
   */
  async handleBindCallback(input: { code: string; state: string }): Promise<ProviderAuthResult> {
    const code = this.ensureCallbackCode(input.code);
    const consumedState = await this.consumeCallbackState(input.state);
    const bindUserId = this.readBindUserIdFromState(consumedState);

    const profile = await this.oauthGateway.resolveProfileByCode({
      code,
      clientId: this.providerConfig.clientId,
      clientSecret: this.providerConfig.clientSecret,
    });

    return this.completeOAuthBindWithProfile(bindUserId, profile, {
      bindingConflictMessage: '企业微信账号绑定冲突：邮箱与手机号命中不同用户',
    });
  }
}
