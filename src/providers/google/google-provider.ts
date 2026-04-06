import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { GoogleProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

/**
 * Google OAuth Provider。
 */
export class GoogleProvider extends BaseOAuthProvider {
  private readonly providerConfig: GoogleProviderConfig;

  /**
   * 创建 Google Provider。
   */
  constructor(config: GoogleProviderConfig) {
    super('Google Provider', 'google', config);
    this.providerConfig = config;
  }

  /**
   * 返回 Google 授权地址。
   */
  protected getAuthorizationEndpoint(): string {
    return 'https://accounts.google.com/o/oauth2/v2/auth';
  }

  /**
   * 返回默认 scope。
   */
  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['openid', 'email', 'profile'];
  }

  /**
   * 处理 Google OAuth 回调。
   */
  async handleCallback(_input: { code: string; state: string }): Promise<ProviderAuthResult> {
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: 'Google OAuth 回调逻辑将在阶段六实现',
      statusCode: 501,
    });
  }
}
