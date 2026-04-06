import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { EmailCodeProviderConfig } from '../../types/auth-config.js';
import type { CredentialProvider, ProviderAuthResult, ProviderContext } from '../base/types.js';

/**
 * 邮箱验证码登录 Provider。
 */
export class EmailCodeProvider implements CredentialProvider {
  name = 'Email Code Provider';
  type = 'email_code' as const;
  enabled: boolean;
  private readonly config: EmailCodeProviderConfig;
  private context?: ProviderContext;

  /**
   * 创建邮箱验证码 Provider。
   */
  constructor(config: EmailCodeProviderConfig) {
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
   * 执行邮箱验证码登录。
   */
  async authenticate(_input: Record<string, unknown>): Promise<ProviderAuthResult> {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'Email Code Provider 尚未初始化',
      });
    }

    // 阶段二只保留统一入口，具体发送和校验流程在阶段四、五补齐。
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: `Email Code Provider 尚未实现，发送器：${this.config.sender}`,
      statusCode: 501,
    });
  }
}
