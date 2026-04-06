import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { PasswordProviderConfig } from '../../types/auth-config.js';
import type { CredentialProvider, ProviderAuthResult, ProviderContext } from '../base/types.js';

/**
 * 密码登录 Provider。
 */
export class PasswordProvider implements CredentialProvider {
  name = 'Password Provider';
  type = 'password' as const;
  enabled: boolean;
  private readonly config: PasswordProviderConfig;
  private context?: ProviderContext;

  /**
   * 创建密码登录 Provider。
   */
  constructor(config: PasswordProviderConfig) {
    this.config = config;
    this.enabled = config.enabled;
  }

  /**
   * 初始化 Provider 上下文。
   */
  async initialize(context: ProviderContext): Promise<void> {
    this.context = context;
  }

  /**
   * 执行账号密码认证。
   */
  async authenticate(_input: Record<string, unknown>): Promise<ProviderAuthResult> {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'Password Provider 尚未初始化',
      });
    }

    // 阶段二只先搭好 Provider 入口，真正的密码校验逻辑放到阶段三实现。
    throw new OmniAuthError({
      code: ERROR_CODES.PROVIDER_RUNTIME_001,
      message: `Password Provider 认证逻辑将在阶段三实现，可用标识配置：${JSON.stringify({
        allowUsername: this.config.allowUsername,
        allowEmail: this.config.allowEmail,
        allowPhone: this.config.allowPhone,
      })}`,
      statusCode: 501,
    });
  }
}
