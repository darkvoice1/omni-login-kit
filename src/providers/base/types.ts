import type { OmniAuthConfig, ProviderType } from '../../types/auth-config.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { Logger } from '../../utils/logger.js';
import type { SessionManager } from '../../services/session/session-manager.js';
import type { IdentityService } from '../../services/identity/identity-service.js';
import type { VerificationService } from '../../services/verification/verification-service.js';
import type { PasswordService } from '../../services/password/password-service.js';

/**
 * Provider 初始化时可拿到的上下文对象。
 */
export interface ProviderContext {
  config: OmniAuthConfig;
  storage: StorageAdapter;
  logger: Logger;
  sessionManager: SessionManager;
  identityService: IdentityService;
  verificationService: VerificationService;
  passwordService: PasswordService;
}

/**
 * Provider 完成认证后的统一返回值。
 */
export interface ProviderAuthResult {
  userId: string;
  identityId: string;
  isNewUser: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * 所有 Provider 的最小接口。
 */
export interface AuthProvider {
  name: string;
  type: ProviderType;
  enabled: boolean;
  initialize(context: ProviderContext): Promise<void>;
}

/**
 * 账号密码、验证码类 Provider 接口。
 */
export interface CredentialProvider extends AuthProvider {
  authenticate(input: Record<string, unknown>): Promise<ProviderAuthResult>;
}

/**
 * 支持本地账号注册的 Provider 接口。
 */
export interface RegisterableCredentialProvider extends CredentialProvider {
  register(input: Record<string, unknown>): Promise<ProviderAuthResult>;
}

/**
 * 支持已知旧密码重置的 Provider 接口。
 */
export interface ResettableCredentialProvider extends CredentialProvider {
  resetPassword(input: Record<string, unknown>): Promise<void>;
}

/**
 * OAuth Provider 接口。
 */
export interface OAuthProvider extends AuthProvider {
  createAuthorizationUrl(input?: Record<string, unknown>): Promise<string>;
  handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult>;
}
