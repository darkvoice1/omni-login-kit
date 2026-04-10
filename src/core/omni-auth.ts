import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type {
  AuthProvider,
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
}
