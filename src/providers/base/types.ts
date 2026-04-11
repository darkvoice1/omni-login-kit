import type { OmniAuthConfig, ProviderType } from '../../types/auth-config.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { Logger } from '../../utils/logger.js';
import type { SessionManager } from '../../services/session/session-manager.js';
import type { IdentityService } from '../../services/identity/identity-service.js';
import type { VerificationService } from '../../services/verification/verification-service.js';
import type { PasswordService } from '../../services/password/password-service.js';
import type { MessageSenderRegistry } from '../../services/messaging/message-sender.js';

export interface ProviderContext {
  config: OmniAuthConfig;
  storage: StorageAdapter;
  logger: Logger;
  sessionManager: SessionManager;
  identityService: IdentityService;
  verificationService: VerificationService;
  passwordService: PasswordService;
  messageSenderRegistry: MessageSenderRegistry;
}

export interface ProviderAuthResult {
  userId: string;
  identityId: string;
  isNewUser: boolean;
  metadata?: Record<string, unknown>;
}

export interface VerificationRequestResult {
  ok: true;
  metadata?: Record<string, unknown>;
}

export interface AuthProvider {
  name: string;
  type: ProviderType;
  enabled: boolean;
  initialize(context: ProviderContext): Promise<void>;
}

export interface CredentialProvider extends AuthProvider {
  authenticate(input: Record<string, unknown>): Promise<ProviderAuthResult>;
}

export interface VerifiableCredentialProvider extends CredentialProvider {
  requestCode(input: Record<string, unknown>): Promise<VerificationRequestResult>;
}

/**
 * 支持请求魔法链接的 Provider 接口。
 */
export interface MagicLinkCredentialProvider extends CredentialProvider {
  requestMagicLink(input: Record<string, unknown>): Promise<VerificationRequestResult>;
}

export interface RegisterableCredentialProvider extends CredentialProvider {
  register(input: Record<string, unknown>): Promise<ProviderAuthResult>;
}

export interface ResettableCredentialProvider extends CredentialProvider {
  resetPassword(input: Record<string, unknown>): Promise<void>;
}

export interface OAuthProvider extends AuthProvider {
  createAuthorizationUrl(input?: Record<string, unknown>): Promise<string>;
  handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult>;
}

/**
 * 支持“已登录用户绑定第三方账号”的 OAuth Provider。
 */
export interface BindableOAuthProvider extends OAuthProvider {
  handleBindCallback(input: { code: string; state: string }): Promise<ProviderAuthResult>;
}
