import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { GitHubProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

/**
 * GitHub OAuth Provider。
 */
export class GitHubProvider extends BaseOAuthProvider {
  private readonly providerConfig: GitHubProviderConfig;

  /**
   * 创建 GitHub Provider。
   */
  constructor(config: GitHubProviderConfig) {
    super('GitHub Provider', 'github', config);
    this.providerConfig = config;
  }

  /**
   * 返回 GitHub 授权地址。
   */
  protected getAuthorizationEndpoint(): string {
    return 'https://github.com/login/oauth/authorize';
  }

  /**
   * 返回默认 scope。
   */
  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['read:user', 'user:email'];
  }

  /**
   * 处理 GitHub OAuth 回调。
   */
  async handleCallback(_input: { code: string; state: string }): Promise<ProviderAuthResult> {
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: 'GitHub OAuth 回调逻辑将在阶段六实现',
      statusCode: 501,
    });
  }
}
