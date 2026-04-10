import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { FeishuProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

/**
 * 飞书 OAuth Provider。
 */
export class FeishuProvider extends BaseOAuthProvider {
  private readonly providerConfig: FeishuProviderConfig;

  constructor(config: FeishuProviderConfig) {
    super('Feishu Provider', 'feishu', config);
    this.providerConfig = config;
  }

  protected getAuthorizationEndpoint(): string {
    return 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
  }

  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['contact:user.base:readonly'];
  }

  async handleCallback(_input: { code: string; state: string }): Promise<ProviderAuthResult> {
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: '飞书 OAuth 回调逻辑将在后续阶段实现',
      statusCode: 501,
    });
  }
}
