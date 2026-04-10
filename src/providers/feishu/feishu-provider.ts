import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { IdentityRecord, UserRecord } from '../../types/entities.js';
import type { FeishuProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult, ProviderContext } from '../base/types.js';
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
    profile: FeishuOAuthProfile,
  ): Promise<{ user: UserRecord | null; linkedBy?: 'email' | 'phone' }> {
    const emailUser = profile.email ? await storage.users.findByEmail(profile.email) : null;
    const phoneUser = profile.phone ? await storage.users.findByPhone(profile.phone) : null;

    if (emailUser && phoneUser && emailUser.id !== phoneUser.id) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_BINDING_001,
        message: '飞书账号绑定冲突：邮箱与手机号命中不同用户',
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
