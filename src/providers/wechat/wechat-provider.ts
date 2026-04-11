import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { WechatProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

interface WechatResolveProfileInput {
  code: string;
  clientId: string;
  clientSecret: string;
}

export interface WechatOAuthProfile {
  providerSubject: string;
  displayName: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface WechatOAuthGateway {
  resolveProfileByCode(input: WechatResolveProfileInput): Promise<WechatOAuthProfile>;
}

interface WechatTokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  openid?: string;
  scope?: string;
  unionid?: string;
}

interface WechatUserInfoResponse {
  errcode?: number;
  errmsg?: string;
  openid?: string;
  nickname?: string;
  headimgurl?: string;
  unionid?: string;
  sex?: number;
  province?: string;
  city?: string;
  country?: string;
}

/**
 * 默认的微信 OAuth 网关实现。
 *
 * 作用：封装“用 code 换用户信息”的外部请求细节，便于单测注入 fake。
 */
class DefaultWechatOAuthGateway implements WechatOAuthGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async resolveProfileByCode(input: WechatResolveProfileInput): Promise<WechatOAuthProfile> {
    const tokenPayload = await this.fetchAccessToken(input.code, input.clientId, input.clientSecret);

    const providerSubject = tokenPayload.unionid ?? tokenPayload.openid;
    if (!providerSubject) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_PROFILE_001,
        message: '微信 OAuth 回调未返回可用用户标识',
        statusCode: 502,
      });
    }

    const userInfo = tokenPayload.openid
      ? await this.fetchUserInfo(tokenPayload.access_token ?? '', tokenPayload.openid)
      : null;

    return {
      providerSubject,
      displayName: userInfo?.nickname ?? tokenPayload.openid ?? providerSubject,
      avatarUrl: userInfo?.headimgurl,
      metadata: {
        openId: tokenPayload.openid,
        unionId: tokenPayload.unionid,
        scope: tokenPayload.scope,
        sex: userInfo?.sex,
        region: userInfo
          ? {
              country: userInfo.country,
              province: userInfo.province,
              city: userInfo.city,
            }
          : undefined,
      },
    };
  }

  /**
   * 使用授权 code 获取微信 access_token。
   */
  private async fetchAccessToken(code: string, clientId: string, clientSecret: string): Promise<WechatTokenResponse> {
    const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    url.searchParams.set('appid', clientId);
    url.searchParams.set('secret', clientSecret);
    url.searchParams.set('code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    const payload = await this.requestJson<WechatTokenResponse>(url.toString(), {
      code: ERROR_CODES.OAUTH_TOKEN_001,
      message: '微信 OAuth 获取 access_token 失败',
    });

    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_TOKEN_001,
        message: '微信 OAuth access_token 响应缺失',
        statusCode: 502,
      });
    }

    return payload;
  }

  /**
   * 使用 access_token 与 openid 获取微信用户资料。
   */
  private async fetchUserInfo(accessToken: string, openId: string): Promise<WechatUserInfoResponse> {
    const url = new URL('https://api.weixin.qq.com/sns/userinfo');
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('openid', openId);
    url.searchParams.set('lang', 'zh_CN');

    return this.requestJson<WechatUserInfoResponse>(url.toString(), {
      code: ERROR_CODES.OAUTH_PROFILE_001,
      message: '微信 OAuth 获取用户资料失败',
    });
  }

  /**
   * 发起 GET 请求并执行微信 errcode 语义校验。
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
 * 微信 OAuth Provider。
 */
export class WechatProvider extends BaseOAuthProvider {
  private readonly providerConfig: WechatProviderConfig;
  private readonly oauthGateway: WechatOAuthGateway;

  /**
   * 创建微信 Provider。
   */
  constructor(config: WechatProviderConfig, oauthGateway?: WechatOAuthGateway) {
    super('WeChat Provider', 'wechat', config);
    this.providerConfig = config;
    this.oauthGateway = oauthGateway ?? new DefaultWechatOAuthGateway();
  }

  /**
   * 返回微信授权地址。
   */
  protected getAuthorizationEndpoint(): string {
    return 'https://open.weixin.qq.com/connect/qrconnect';
  }

  /**
   * 返回默认 scope。
   */
  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['snsapi_login'];
  }

  /**
   * 处理微信 OAuth 回调。
   */
  async handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult> {
    const code = this.ensureCallbackCode(input.code);
    await this.consumeCallbackState(input.state);

    const profile = await this.oauthGateway.resolveProfileByCode({
      code,
      clientId: this.providerConfig.clientId,
      clientSecret: this.providerConfig.clientSecret,
    });

    return this.completeOAuthLoginWithProfile(profile);
  }

  /**
   * 处理“已登录用户绑定微信账号”回调。
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
      bindingConflictMessage: '微信账号绑定冲突：第三方身份已绑定到其他用户',
    });
  }
}
