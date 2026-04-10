import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { WecomProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

/**
 * 企业微信 OAuth Provider。
 */
export class WecomProvider extends BaseOAuthProvider {
  private readonly providerConfig: WecomProviderConfig;

  constructor(config: WecomProviderConfig) {
    super('WeCom Provider', 'wecom', config);
    this.providerConfig = config;
  }

  protected getAuthorizationEndpoint(): string {
    return 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect';
  }

  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['snsapi_login'];
  }

  async handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult> {
    const code = this.ensureCallbackCode(input.code);
    const stateRecord = await this.consumeCallbackState(input.state);

    // 关键步骤：先完成 state 防重放校验，再进入后续 OAuth 对接逻辑。
    void code;
    void stateRecord;
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: '企业微信 OAuth 回调逻辑将在后续阶段实现',
      statusCode: 501,
    });
  }
}

