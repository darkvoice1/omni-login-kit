import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { FeishuProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

interface FeishuResolveProfileInput {
  code: string;
  clientId: string;
  clientSecret: string;
}

export interface FeishuOAuthProfile {
  providerSubject: string;
  displayName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface FeishuOAuthGateway {
  resolveProfileByCode(input: FeishuResolveProfileInput): Promise<FeishuOAuthProfile>;
}

interface FeishuApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

interface FeishuTokenPayload {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface FeishuUserInfoPayload {
  open_id?: string;
  union_id?: string;
  user_id?: string;
  name?: string;
  en_name?: string;
  avatar_url?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
}

/**
 * 默认的飞书 OAuth 网关实现。
 *
 * 作用：封装“用 code 换用户资料”的外部请求细节，便于单测注入 fake。
 */
class DefaultFeishuOAuthGateway implements FeishuOAuthGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async resolveProfileByCode(input: FeishuResolveProfileInput): Promise<FeishuOAuthProfile> {
    const userAccessToken = await this.fetchUserAccessToken(input.code, input.clientId, input.clientSecret);
    const userInfo = await this.fetchUserInfo(userAccessToken);

    const providerSubject = userInfo.open_id ?? userInfo.union_id ?? userInfo.user_id;
    if (!providerSubject) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_PROFILE_001,
        message: '飞书 OAuth 回调未返回可用用户标识',
        statusCode: 502,
      });
    }

    return {
      providerSubject,
      displayName: userInfo.name ?? userInfo.en_name ?? providerSubject,
      email: userInfo.email ?? userInfo.enterprise_email,
      phone: userInfo.mobile,
      avatarUrl: userInfo.avatar_url,
      metadata: {
        openId: userInfo.open_id,
        unionId: userInfo.union_id,
        userId: userInfo.user_id,
      },
    };
  }

  /**
   * 使用授权 code 换取飞书 user_access_token。
   */
  private async fetchUserAccessToken(code: string, clientId: string, clientSecret: string): Promise<string> {
    const payload = await this.requestData<FeishuTokenPayload>(
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
      {
        code: ERROR_CODES.OAUTH_TOKEN_001,
        message: '飞书 OAuth 获取 user_access_token 失败',
      },
    );

    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_TOKEN_001,
        message: '飞书 OAuth user_access_token 响应缺失',
        statusCode: 502,
      });
    }

    return payload.access_token.trim();
  }

  /**
   * 通过 user_access_token 拉取飞书用户资料。
   */
  private async fetchUserInfo(userAccessToken: string): Promise<FeishuUserInfoPayload> {
    return this.requestData<FeishuUserInfoPayload>(
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
        },
      },
      {
        code: ERROR_CODES.OAUTH_PROFILE_001,
        message: '飞书 OAuth 获取用户资料失败',
      },
    );
  }

  /**
   * 请求飞书接口并处理 code/msg 语义。
   */
  private async requestData<T>(
    url: string,
    init: RequestInit,
    error: { code: typeof ERROR_CODES[keyof typeof ERROR_CODES]; message: string },
  ): Promise<T> {
    try {
      const response = await this.fetchImpl(url, init);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as FeishuApiEnvelope<T>;
      if (typeof payload.code === 'number' && payload.code !== 0) {
        throw new OmniAuthError({
          code: error.code,
          message: `${error.message}：${payload.msg ?? `code=${payload.code}`}`,
          statusCode: 502,
        });
      }

      if (!payload.data) {
        throw new OmniAuthError({
          code: error.code,
          message: `${error.message}：响应 data 为空`,
          statusCode: 502,
        });
      }

      return payload.data;
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
 * 飞书 OAuth Provider。
 */
export class FeishuProvider extends BaseOAuthProvider {
  private readonly providerConfig: FeishuProviderConfig;
  private readonly oauthGateway: FeishuOAuthGateway;

  constructor(config: FeishuProviderConfig, oauthGateway?: FeishuOAuthGateway) {
    super('Feishu Provider', 'feishu', config);
    this.providerConfig = config;
    this.oauthGateway = oauthGateway ?? new DefaultFeishuOAuthGateway();
  }

  protected getAuthorizationEndpoint(): string {
    return 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
  }

  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['contact:user.base:readonly'];
  }

  /**
   * 处理飞书 OAuth 回调。
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
      bindingConflictMessage: '飞书账号绑定冲突：邮箱与手机号命中不同用户',
    });
  }
}
