import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { SmsProviderConfig } from '../../types/auth-config.js';
import type { CredentialProvider, ProviderAuthResult, ProviderContext } from '../base/types.js';

/**
 * 短信验证码登录 Provider。
 */
export class SmsProvider implements CredentialProvider {
  name = 'SMS Provider';
  type = 'sms' as const;
  enabled: boolean;
  private readonly config: SmsProviderConfig;
  private context?: ProviderContext;

  /**
   * 创建短信验证码 Provider。
   */
  constructor(config: SmsProviderConfig) {
    this.config = config;
    this.enabled = config.enabled;
  }

  /**
   * 初始化 Provider。
   */
  async initialize(context: ProviderContext): Promise<void> {
    this.context = context;
  }

  /**
   * 执行短信验证码登录。
   */
  async authenticate(_input: Record<string, unknown>): Promise<ProviderAuthResult> {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'SMS Provider 尚未初始化',
      });
    }

    // 阶段二先建立统一扩展点，短信流程将在阶段七补齐。
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: `SMS Provider 尚未实现，发送器：${this.config.sender}`,
      statusCode: 501,
    });
  }
}
