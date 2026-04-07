import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type { AuthProvider, CredentialProvider, OAuthProvider, ProviderContext, ProviderAuthResult } from '../providers/base/types.js';
import { EmailCodeProvider } from '../providers/email/email-code-provider.js';
import { EmailMagicLinkProvider } from '../providers/email/email-magic-link-provider.js';
import { GitHubProvider } from '../providers/github/github-provider.js';
import { GoogleProvider } from '../providers/google/google-provider.js';
import { PasswordProvider } from '../providers/password/password-provider.js';
import { SmsProvider } from '../providers/sms/sms-provider.js';
import { WechatProvider } from '../providers/wechat/wechat-provider.js';
import { IdentityService } from '../services/identity/identity-service.js';
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
  }

  /**
   * 初始化整个认证系统。
   */
  async initialize(): Promise<void> {
    // 先连接存储层，保证后续 Provider 初始化可正常访问数据。
    await this.storage.connect();

    // 再根据配置自动注册所有首版内置 Provider。
    const providers = this.config.providers.map((providerConfig) => this.buildProvider(providerConfig));
    this.providerRegistry.registerMany(providers);

    // 最后为每个 Provider 注入统一上下文。
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

  /**
   * 执行账号类 Provider 登录。
   *
   * Provider 只负责“认证是否通过”，登录态统一由核心层签发。
   */
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

    // 先让 Provider 完成账号认证，再由核心层统一签发登录态。
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

  /**
   * 获取 OAuth 授权地址。
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
   * 处理 OAuth 回调。
   */
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
   * 关闭认证系统并释放资源。
   */
  async shutdown(): Promise<void> {
    await this.storage.disconnect();
  }

  /**
   * 创建 Provider 上下文。
   */
  private createProviderContext(): ProviderContext {
    return {
      config: this.config,
      storage: this.storage,
      logger: this.logger,
      sessionManager: this.sessionManager,
      identityService: this.identityService,
      verificationService: this.verificationService,
      passwordService: this.passwordService,
    };
  }

  /**
   * 根据配置生成内置 Provider。
   */
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
          message: `未支持的 Provider：${config.type}`,
        });
    }
  }

  /**
   * 判断是否为账号类 Provider。
   */
  private isCredentialProvider(provider: AuthProvider): provider is CredentialProvider {
    return 'authenticate' in provider;
  }

  /**
   * 判断是否为 OAuth Provider。
   */
  private isOAuthProvider(provider: AuthProvider): provider is OAuthProvider {
    return 'createAuthorizationUrl' in provider && 'handleCallback' in provider;
  }
}
