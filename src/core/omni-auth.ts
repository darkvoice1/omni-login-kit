import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type {
  AuthProvider,
  BindableOAuthProvider,
  CredentialProvider,
  MagicLinkCredentialProvider,
  OAuthProvider,
  ProviderContext,
  ProviderAuthResult,
  RegisterableCredentialProvider,
  ResettableCredentialProvider,
  VerifiableCredentialProvider,
  VerificationRequestResult,
} from '../providers/base/types.js';
import { EmailCodeProvider } from '../providers/email/email-code-provider.js';
import { EmailMagicLinkProvider } from '../providers/email/email-magic-link-provider.js';
import { PasswordProvider } from '../providers/password/password-provider.js';
import { SmsProvider } from '../providers/sms/sms-provider.js';
import { WechatProvider } from '../providers/wechat/wechat-provider.js';
import { WecomProvider } from '../providers/wecom/wecom-provider.js';
import { FeishuProvider } from '../providers/feishu/feishu-provider.js';
import { IdentityService } from '../services/identity/identity-service.js';
import { MessageSenderRegistry } from '../services/messaging/message-sender.js';
import { PasswordService } from '../services/password/password-service.js';
import { SessionManager } from '../services/session/session-manager.js';
import { VerificationService } from '../services/verification/verification-service.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import type { OmniAuthConfig, ProviderConfig, ProviderType } from '../types/auth-config.js';
import type { IdentityRecord, UserRecord } from '../types/entities.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { ProviderRegistry } from './provider-registry.js';

export interface CredentialAuthRuntimeContext {
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: Record<string, unknown>;
}

export interface CredentialAuthSuccessResult extends ProviderAuthResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface LogoutSuccessResult {
  ok: true;
}

export interface ResetPasswordSuccessResult {
  ok: true;
}

export interface UnbindIdentitySuccessResult {
  ok: true;
}

/**
 * 统一认证核心。
 */
export class OmniAuth {
  readonly config: OmniAuthConfig;
  readonly storage: StorageAdapter;
  readonly logger: Logger;
  readonly providerRegistry: ProviderRegistry;
  readonly sessionManager: SessionManager;
  readonly identityService: IdentityService;
  readonly verificationService: VerificationService;
  readonly passwordService: PasswordService;
  readonly messageSenderRegistry: MessageSenderRegistry;

  constructor(input: {
    config: OmniAuthConfig;
    storage: StorageAdapter;
    logger?: Logger;
  }) {
    this.config = input.config;
    this.storage = input.storage;
    this.logger = input.logger ?? createLogger();
    this.providerRegistry = new ProviderRegistry();
    this.sessionManager = new SessionManager(input.config.session, input.storage);
    this.identityService = new IdentityService(input.storage);
    this.verificationService = new VerificationService(input.storage);
    this.passwordService = new PasswordService();
    this.messageSenderRegistry = MessageSenderRegistry.fromConfig(input.config);
  }

  async initialize(): Promise<void> {
    await this.storage.connect();

    const providers = this.config.providers.map((providerConfig) => this.buildProvider(providerConfig));
    this.providerRegistry.registerMany(providers);

    const context = this.createProviderContext();
    for (const provider of this.providerRegistry.list()) {
      await provider.initialize(context);
    }
  }

  listEnabledProviders(): AuthProvider[] {
    return this.providerRegistry.listEnabled();
  }

  async authenticateWithCredentials(
    providerType: ProviderType,
    input: Record<string, unknown>,
    runtimeContext?: CredentialAuthRuntimeContext,
  ): Promise<CredentialAuthSuccessResult> {
    const provider = this.providerRegistry.get(providerType);

    if (!this.isCredentialProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: `${providerType} 不是账号类 Provider`,
        statusCode: 400,
      });
    }

    const authResult = await provider.authenticate(input);
    const sessionTokens = await this.sessionManager.createSessionTokens({
      userId: authResult.userId,
      deviceInfo: runtimeContext?.deviceInfo,
      ipAddress: runtimeContext?.ipAddress,
      userAgent: runtimeContext?.userAgent,
    });

    return {
      ...authResult,
      accessToken: sessionTokens.accessToken,
      refreshToken: sessionTokens.refreshToken,
      sessionId: sessionTokens.sessionId,
    };
  }

  async requestEmailCode(input: Record<string, unknown>): Promise<VerificationRequestResult> {
    const provider = this.providerRegistry.get('email_code');
    if (!this.isVerifiableCredentialProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: '当前未找到可用的邮箱验证码 Provider',
        statusCode: 400,
      });
    }

    return provider.requestCode(input);
  }

  async requestSmsCode(input: Record<string, unknown>): Promise<VerificationRequestResult> {
    const provider = this.providerRegistry.get('sms');
    if (!this.isVerifiableCredentialProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: '当前未找到可用的短信验证码 Provider',
        statusCode: 400,
      });
    }

    return provider.requestCode(input);
  }

  /**
   * 请求邮箱魔法链接。
   */
  async requestEmailMagicLink(input: Record<string, unknown>): Promise<VerificationRequestResult> {
    const provider = this.providerRegistry.get('email_magic_link');
    if (!this.isMagicLinkCredentialProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: '当前未找到可用的邮箱魔法链接 Provider',
        statusCode: 400,
      });
    }

    return provider.requestMagicLink(input);
  }

  async registerWithPassword(input: Record<string, unknown>): Promise<ProviderAuthResult> {
    const provider = this.providerRegistry.get('password');
    if (!this.isRegisterableCredentialProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: '当前未找到可用的密码注册 Provider',
        statusCode: 400,
      });
    }

    return provider.register(input);
  }

  async resetPassword(input: Record<string, unknown>): Promise<ResetPasswordSuccessResult> {
    const provider = this.providerRegistry.get('password');
    if (!this.isResettableCredentialProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: '当前未找到可用的密码重置 Provider',
        statusCode: 400,
      });
    }

    await provider.resetPassword(input);
    return {
      ok: true,
    };
  }

  async logout(input: Record<string, unknown>): Promise<LogoutSuccessResult> {
    const sessionId = this.readSessionId(input);
    await this.sessionManager.revokeSession(sessionId);
    return {
      ok: true,
    };
  }

  /**
   * 创建 OAuth 授权地址（登录场景）。
   */
  async createAuthorizationUrl(
    providerType: ProviderType,
    input?: Record<string, unknown>,
  ): Promise<string> {
    const provider = this.providerRegistry.get(providerType);

    if (!this.isOAuthProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: `${providerType} 不是 OAuth Provider`,
        statusCode: 400,
      });
    }

    return provider.createAuthorizationUrl(input);
  }

  /**
   * 创建 OAuth 授权地址（账号绑定场景）。
   */
  async createBindAuthorizationUrl(providerType: ProviderType, accessToken: string): Promise<string> {
    const user = await this.resolveActiveUserByAccessToken(accessToken);
    return this.createAuthorizationUrl(providerType, {
      // 通过 state 持久化绑定上下文，回调时可安全还原当前用户。
      redirectTo: `bind_user_id:${user.id}`,
    });
  }

  async handleOAuthCallback(
    providerType: ProviderType,
    input: { code: string; state: string },
  ): Promise<ProviderAuthResult> {
    const provider = this.providerRegistry.get(providerType);

    if (!this.isOAuthProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: `${providerType} 不是 OAuth Provider`,
        statusCode: 400,
      });
    }

    return provider.handleCallback(input);
  }

  /**
   * 处理“已登录用户绑定第三方账号”回调。
   */
  async handleOAuthBindCallback(
    providerType: ProviderType,
    input: { code: string; state: string },
  ): Promise<ProviderAuthResult> {
    const provider = this.providerRegistry.get(providerType);

    if (!this.isBindableOAuthProvider(provider)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_002,
        message: `${providerType} 不支持账号绑定`,
        statusCode: 400,
      });
    }

    return provider.handleBindCallback(input);
  }

  /**
   * 根据 access token 列出当前用户绑定的身份。
   */
  async listMyIdentities(accessToken: string): Promise<IdentityRecord[]> {
    const user = await this.resolveActiveUserByAccessToken(accessToken);
    return this.identityService.listUserIdentities(user.id);
  }

  /**
   * 根据 access token 解绑一个身份。
   */
  async unbindIdentity(accessToken: string, identityId: string): Promise<UnbindIdentitySuccessResult> {
    const user = await this.resolveActiveUserByAccessToken(accessToken);
    const cleanIdentityId = identityId.trim();
    if (!cleanIdentityId) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '解绑必须提供 identityId',
        statusCode: 400,
      });
    }

    const identities = await this.identityService.listUserIdentities(user.id);
    const targetIdentity = identities.find((item) => item.id === cleanIdentityId);
    if (!targetIdentity) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_001,
        message: '身份不存在或不属于当前用户',
        statusCode: 404,
      });
    }

    // 安全策略：至少保留一种可用登录身份，避免用户把自己“锁死”。
    if (identities.length <= 1) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '至少保留一种登录方式，无法解绑最后一个身份',
        statusCode: 400,
      });
    }

    await this.identityService.deleteIdentity(targetIdentity.id);
    return {
      ok: true,
    };
  }

  async shutdown(): Promise<void> {
    await this.storage.disconnect();
  }

  private createProviderContext(): ProviderContext {
    return {
      config: this.config,
      storage: this.storage,
      logger: this.logger,
      sessionManager: this.sessionManager,
      identityService: this.identityService,
      verificationService: this.verificationService,
      passwordService: this.passwordService,
      messageSenderRegistry: this.messageSenderRegistry,
    };
  }

  /**
   * 从 access token 解析并校验当前用户。
   */
  private async resolveActiveUserByAccessToken(accessToken: string): Promise<UserRecord> {
    const cleanAccessToken = accessToken.trim();
    if (!cleanAccessToken) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '请求缺少 accessToken',
        statusCode: 401,
      });
    }

    const tokenPayload = this.sessionManager.verifyAccessToken(cleanAccessToken);
    const user = await this.identityService.findUserById(tokenPayload.sub);
    if (!user) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_001,
        message: '当前登录用户不存在',
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

    return user;
  }

  private readSessionId(input: Record<string, unknown>): string {
    const sessionId = input.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '退出登录必须提供 sessionId 字段',
      });
    }

    return sessionId.trim();
  }

  private buildProvider(config: ProviderConfig): AuthProvider {
    switch (config.type) {
      case 'password':
        return new PasswordProvider(config);
      case 'email_code':
        return new EmailCodeProvider(config);
      case 'email_magic_link':
        return new EmailMagicLinkProvider(config);
      case 'sms':
        return new SmsProvider(config);
      case 'wechat':
        return new WechatProvider(config);
      case 'wecom':
        return new WecomProvider(config);
      case 'feishu':
        return new FeishuProvider(config);
      default:
        throw new OmniAuthError({
          code: ERROR_CODES.AUTH_PROVIDER_001,
          message: '未支持的 Provider',
        });
    }
  }

  private isCredentialProvider(provider: AuthProvider): provider is CredentialProvider {
    return 'authenticate' in provider;
  }

  private isVerifiableCredentialProvider(
    provider: AuthProvider,
  ): provider is VerifiableCredentialProvider {
    return 'requestCode' in provider;
  }

  /**
   * 判断是否支持请求魔法链接。
   */
  private isMagicLinkCredentialProvider(
    provider: AuthProvider,
  ): provider is MagicLinkCredentialProvider {
    return 'requestMagicLink' in provider;
  }

  private isRegisterableCredentialProvider(
    provider: AuthProvider,
  ): provider is RegisterableCredentialProvider {
    return 'register' in provider;
  }

  private isResettableCredentialProvider(
    provider: AuthProvider,
  ): provider is ResettableCredentialProvider {
    return 'resetPassword' in provider;
  }

  private isOAuthProvider(provider: AuthProvider): provider is OAuthProvider {
    return 'createAuthorizationUrl' in provider && 'handleCallback' in provider;
  }

  private isBindableOAuthProvider(provider: AuthProvider): provider is BindableOAuthProvider {
    return this.isOAuthProvider(provider) && 'handleBindCallback' in provider;
  }
}
