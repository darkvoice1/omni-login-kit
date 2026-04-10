import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { WechatProviderConfig } from '../../types/auth-config.js';
import type { ProviderAuthResult } from '../base/types.js';
import { BaseOAuthProvider } from '../base/base-oauth-provider.js';

/**
 * 微信 OAuth Provider。
 */
export class WechatProvider extends BaseOAuthProvider {
  private readonly providerConfig: WechatProviderConfig;

  /**
   * 创建微信 Provider。
   */
  constructor(config: WechatProviderConfig) {
    super('WeChat Provider', 'wechat', config);
    this.providerConfig = config;
  }

  /**
   * 返回微信授权地址。
   */
  protected getAuthorizationEndpoint(): string {
    return 'https://open.weixin.qq.com/connect/qrconnect';
  }

  /**
   * 返回默认 scope。
   */
  protected getDefaultScope(): string[] {
    return this.providerConfig.scope ?? ['snsapi_login'];
  }

  /**
   * 处理微信 OAuth 回调。
   */
  async handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult> {
    const code = this.ensureCallbackCode(input.code);
    const stateRecord = await this.consumeCallbackState(input.state);

    // 关键步骤：先完成 state 防重放校验，再进入后续 OAuth 对接逻辑。
    void code;
    void stateRecord;
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: '微信 OAuth 回调逻辑将在阶段六实现',
      statusCode: 501,
    });
  }
}

