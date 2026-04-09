import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type {
  AuthProvider,
  CredentialProvider,
  OAuthProvider,
  ProviderContext,
  ProviderAuthResult,
  RegisterableCredentialProvider,
  ResettableCredentialProvider,
} from '../providers/base/types.js';
import { EmailCodeProvider } from '../providers/email/email-code-provider.js';
import { EmailMagicLinkProvider } from '../providers/email/email-magic-link-provider.js';
import { GitHubProvider } from '../providers/github/github-provider.js';
import { GoogleProvider } from '../providers/google/google-provider.js';
import { PasswordProvider } from '../providers/password/password-provider.js';
import { SmsProvider } from '../providers/sms/sms-provider.js';
import { WechatProvider } from '../providers/wechat/wechat-provider.js';
import { IdentityService } from '../services/identity/identity-service.js';
import { MessageSenderRegistry } from '../services/messaging/message-sender.js';
import { PasswordService } from '../services/password/password-service.js';
import { SessionManager } from '../services/session/session-manager.js';
import { VerificationService } from '../services/verification/verification-service.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import type { OmniAuthConfig, ProviderConfig, ProviderType } from '../types/auth-config.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { ProviderRegistry } from './provider-registry.js';

/**
 * 账号类登录请求时可传入的运行时上下文。
 */
export interface CredentialAuthRuntimeContext {
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: Record<string, unknown>;
}

/**
 * 账号类登录最终成功返回结果。
 *
 * 这里是在 Provider 认证成功结果的基础上，再补上核心层统一签发的登录态信息。
 */
export interface CredentialAuthSuccessResult extends ProviderAuthResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

/**
 * 退出登录成功返回结果。
 */
export interface LogoutSuccessResult {
  ok: true;
}

/**
 * 重置密码成功返回结果。
 */
export interface ResetPasswordSuccessResult {
  ok: true;
}

/**
 * 整个认证系统的核心调度入口。
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

  /**
   * 创建核心认证对象。
   */
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

  /**
   * 初始化整个认证系统。
   */
  async initialize(): Promise<void> {
    await this.storage.connect();

    const providers = this.config.providers.map((providerConfig) => this.buildProvider(providerConfig));
    this.providerRegistry.registerMany(providers);

    const context = this.createProviderContext();
    for (const provider of this.providerRegistry.list()) {
      await provider.initialize(context);
    }
  }

  /**
   * 获取所有已启用 Provider。
   */
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
      case 'github':
        return new GitHubProvider(config);
      case 'google':
        return new GoogleProvider(config);
      case 'wechat':
        return new WechatProvider(config);
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
}
