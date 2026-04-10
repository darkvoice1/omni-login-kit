import { createHash, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { BaseOAuthProviderConfig, ProviderType } from '../../types/auth-config.js';
import type { IdentityRecord, OAuthStateRecord, UserRecord } from '../../types/entities.js';
import type { OAuthProvider, ProviderAuthResult, ProviderContext } from './types.js';

export interface OAuthLoginProfile {
  providerSubject: string;
  displayName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface OAuthLoginOptions {
  enableContactBinding?: boolean;
  bindingConflictMessage?: string;
}

/**
 * OAuth Provider 的基础实现。
 */
export abstract class BaseOAuthProvider implements OAuthProvider {
  name: string;
  type: ProviderType;
  enabled: boolean;
  protected config: BaseOAuthProviderConfig;
  protected context?: ProviderContext;

  /**
   * 创建基础 OAuth Provider。
   */
  constructor(name: string, type: ProviderType, config: BaseOAuthProviderConfig) {
    this.name = name;
    this.type = type;
    this.enabled = config.enabled;
    this.config = config;
  }

  /**
   * 缓存上下文，供后续授权和回调流程复用。
   */
  async initialize(context: ProviderContext): Promise<void> {
    this.context = context;
  }

  /**
   * 生成授权地址，并把 state 存入存储层。
   */
  async createAuthorizationUrl(input?: Record<string, unknown>): Promise<string> {
    const context = this.ensureContext();

    // 先生成原始 state，并对存库值做哈希处理。
    const rawState = randomUUID();
    const stateHash = createHash('sha256').update(rawState).digest('hex');

    // 再把 state 入库，后续回调时可以做一次性消费校验。
    await context.storage.oauthStates.create({
      providerType: this.type,
      stateHash,
      redirectTo: typeof input?.redirectTo === 'string' ? input.redirectTo : undefined,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    // 最后拼接标准授权地址并返回给调用方。
    const url = new URL(this.getAuthorizationEndpoint());
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.getCallbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', rawState);
    url.searchParams.set('scope', (this.config.scope ?? this.getDefaultScope()).join(' '));

    return url.toString();
  }

  /**
   * 处理 OAuth 回调。
   */
  abstract handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult>;

  /**
   * 返回授权端点。
   */
  protected abstract getAuthorizationEndpoint(): string;

  /**
   * 返回默认 scope。
   */
  protected abstract getDefaultScope(): string[];

  /**
   * 校验并标准化 OAuth 回调 code。
   */
  protected ensureCallbackCode(rawCode: string): string {
    const code = rawCode.trim();
    if (!code) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_CODE_001,
        message: 'OAuth 回调缺少 code 参数',
        statusCode: 400,
      });
    }

    return code;
  }

  /**
   * 校验并一次性消费 OAuth 回调 state。
   */
  protected async consumeCallbackState(rawState: string): Promise<OAuthStateRecord> {
    const state = rawState.trim();
    if (!state) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_STATE_001,
        message: 'OAuth 回调缺少 state 参数',
        statusCode: 400,
      });
    }

    const context = this.ensureContext();
    const stateHash = createHash('sha256').update(state).digest('hex');

    // 关键步骤：原子消费 state，失败即视为无效、过期或已被使用。
    const consumedState = await context.storage.oauthStates.consumeByStateHash(stateHash, new Date());
    if (!consumedState) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_STATE_002,
        message: 'OAuth state 无效、已过期或已被消费',
        statusCode: 400,
      });
    }

    return consumedState;
  }

  /**
   * 用统一流程完成 OAuth 登录落库。
   *
   * 默认只按 providerSubject 绑定；如启用 `enableContactBinding`，会尝试按邮箱/手机号归并已有用户。
   */
  protected async completeOAuthLoginWithProfile(
    profile: OAuthLoginProfile,
    options?: OAuthLoginOptions,
  ): Promise<ProviderAuthResult> {
    const context = this.ensureContext();
    const enableContactBinding = options?.enableContactBinding ?? false;
    const bindingConflictMessage =
      options?.bindingConflictMessage ?? `${this.name} 账号绑定冲突：邮箱与手机号命中不同用户`;

    return context.storage.transaction(async (storage) => {
      // 关键步骤 1：优先命中“已绑定身份”路径。
      const existingIdentity = await storage.identities.findByProvider(this.type, profile.providerSubject);
      if (existingIdentity) {
        return this.loginWithExistingIdentity(storage, existingIdentity);
      }

      // 关键步骤 2：按需执行邮箱/手机号归并，未命中则创建新用户。
      const bindingResult = enableContactBinding
        ? await this.resolveBindTargetUser(storage, profile, bindingConflictMessage)
        : { user: null as UserRecord | null };

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
   * 获取回调地址。
   */
  protected getCallbackUrl(): string {
    const context = this.ensureContext();
    return `${context.config.baseUrl}${context.config.routePrefix}/oauth/${this.type}/callback`;
  }

  /**
   * 获取已初始化的上下文。
   */
  protected ensureContext(): ProviderContext {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: `${this.name} 尚未初始化`,
      });
    }

    return this.context;
  }

  /**
   * 已存在身份时的统一登录逻辑。
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
    profile: OAuthLoginProfile,
    conflictMessage: string,
  ): Promise<{ user: UserRecord | null; linkedBy?: 'email' | 'phone' }> {
    const emailUser = profile.email ? await storage.users.findByEmail(profile.email) : null;
    const phoneUser = profile.phone ? await storage.users.findByPhone(profile.phone) : null;

    if (emailUser && phoneUser && emailUser.id !== phoneUser.id) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_BINDING_001,
        message: conflictMessage,
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
