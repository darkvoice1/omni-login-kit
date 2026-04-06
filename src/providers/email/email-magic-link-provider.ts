import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { EmailMagicLinkProviderConfig } from '../../types/auth-config.js';
import type { CredentialProvider, ProviderAuthResult, ProviderContext } from '../base/types.js';

/**
 * 邮箱魔法链接 Provider。
 */
export class EmailMagicLinkProvider implements CredentialProvider {
  name = 'Email Magic Link Provider';
  type = 'email_magic_link' as const;
  enabled: boolean;
  private readonly config: EmailMagicLinkProviderConfig;
  private context?: ProviderContext;

  /**
   * 创建邮箱魔法链接 Provider。
   */
  constructor(config: EmailMagicLinkProviderConfig) {
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
   * 执行邮箱魔法链接登录。
   */
  async authenticate(_input: Record<string, unknown>): Promise<ProviderAuthResult> {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'Email Magic Link Provider 尚未初始化',
      });
    }

    // 阶段二先占位，后续会接入魔法链接令牌生成和消费逻辑。
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: `Email Magic Link Provider 尚未实现，发送器：${this.config.sender}`,
      statusCode: 501,
    });
  }
}
