import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { IdentityRecord, UserRecord } from '../../types/entities.js';
import type { WecomProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult, ProviderContext } from '../base/types.js';
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

    const context = this.ensureContext();
    const profile = await this.oauthGateway.resolveProfileByCode({
      code,
      clientId: this.providerConfig.clientId,
      clientSecret: this.providerConfig.clientSecret,
    });

    return context.storage.transaction(async (storage) => {
      // 关键步骤 1：优先命中“已绑定身份”路径。
      const existingIdentity = await storage.identities.findByProvider(this.type, profile.providerSubject);
      if (existingIdentity) {
        return this.loginWithExistingIdentity(storage, existingIdentity);
      }

      // 关键步骤 2：身份不存在时，尝试按邮箱/手机号绑定到已有用户。
      const bindingResult = await this.resolveBindTargetUser(storage, profile);
      const user =
        bindingResult.user ??
        (await storage.users.create({
          displayName: profile.displayName || profile.providerSubject,
          email: profile.email,
          phone: profile.phone,
          avatarUrl: profile.avatarUrl,
          status: 'active',
        }));

      if (user.status === 'disabled') {
        throw new OmniAuthError({
          code: ERROR_CODES.AUTH_USER_002,
          message: '用户已被禁用',
          statusCode: 403,
        });
      }

      const identity = await storage.identities.create({
        userId: user.id,
        providerType: this.type,
        providerSubject: profile.providerSubject,
        email: profile.email,
        phone: profile.phone,
        nickname: profile.displayName,
        avatarUrl: profile.avatarUrl,
        metadata: profile.metadata ?? {},
      });

      await storage.users.updateLastLoginAt(user.id, new Date());

      return {
        userId: user.id,
        identityId: identity.id,
        isNewUser: !bindingResult.user,
        metadata: {
          loginType: this.type,
          linkedBy: bindingResult.linkedBy ?? 'new_user',
        },
      };
    });
  }

  /**
   * 已存在身份时的登录逻辑。
   */
  private async loginWithExistingIdentity(
    storage: ProviderContext['storage'],
    identity: IdentityRecord,
  ): Promise<ProviderAuthResult> {
    const user = await storage.users.findById(identity.userId);
    if (!user) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_001,
        message: '用户不存在',
        statusCode: 404,
      });
    }

    if (user.status === 'disabled') {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_002,
        message: '用户已被禁用',
        statusCode: 403,
      });
    }

    await storage.users.updateLastLoginAt(user.id, new Date());

    return {
      userId: user.id,
      identityId: identity.id,
      isNewUser: false,
      metadata: {
        loginType: this.type,
        linkedBy: 'existing_identity',
      },
    };
  }

  /**
   * 按邮箱/手机号查找可绑定用户；若命中不同用户则抛冲突错误。
   */
  private async resolveBindTargetUser(
    storage: ProviderContext['storage'],
    profile: WecomOAuthProfile,
  ): Promise<{ user: UserRecord | null; linkedBy?: 'email' | 'phone' }> {
    const emailUser = profile.email ? await storage.users.findByEmail(profile.email) : null;
    const phoneUser = profile.phone ? await storage.users.findByPhone(profile.phone) : null;

    if (emailUser && phoneUser && emailUser.id !== phoneUser.id) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_BINDING_001,
        message: '企业微信账号绑定冲突：邮箱与手机号命中不同用户',
        statusCode: 409,
      });
    }

    if (emailUser) {
      return {
        user: emailUser,
        linkedBy: 'email',
      };
    }

    if (phoneUser) {
      return {
        user: phoneUser,
        linkedBy: 'phone',
      };
    }

    return {
      user: null,
    };
  }
}

