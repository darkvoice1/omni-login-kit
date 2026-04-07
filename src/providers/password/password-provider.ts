import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { PasswordLoginIdentifierType } from '../../storage/storage-adapter.js';
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
  async authenticate(input: Record<string, unknown>): Promise<ProviderAuthResult> {
    const context = this.ensureContext();
    const account = this.readAccount(input);
    const password = this.readPassword(input);

    // 先识别用户输入的账号类型，后面才能走对应的查询逻辑。
    const identifierType = this.detectIdentifierType(account);

    // 再用统一存储接口查找本地密码身份。
    const identity = await context.storage.identities.findPasswordIdentityByIdentifier({
      identifierType,
      identifierValue: account,
    });

    if (!identity) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_CREDENTIALS_001,
        message: '账号或密码错误',
        statusCode: 401,
      });
    }

    // 找到身份后，再根据 identity.id 查询密码凭证。
    const credential = await context.storage.credentials.findByIdentityId(identity.id);
    if (!credential) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_CREDENTIALS_001,
        message: '账号或密码错误',
        statusCode: 401,
      });
    }

    // 使用统一密码服务校验明文密码与存储哈希是否匹配。
    const isPasswordValid = await context.passwordService.verifyPassword(password, credential.passwordHash);
    if (!isPasswordValid) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_CREDENTIALS_001,
        message: '账号或密码错误',
        statusCode: 401,
      });
    }

    // 这一小步先把“查身份 + 校验密码”打通，用户状态校验和会话签发放下一步做。
    return {
      userId: identity.userId,
      identityId: identity.id,
      isNewUser: false,
      metadata: {
        identifierType,
      },
    };
  }

  /**
   * 读取并校验账号字段。
   */
  private readAccount(input: Record<string, unknown>): string {
    const account = input.account;
    if (typeof account !== 'string' || !account.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '密码登录必须提供 account 字段',
      });
    }

    return account.trim();
  }

  /**
   * 读取并校验密码字段。
   */
  private readPassword(input: Record<string, unknown>): string {
    const password = input.password;
    if (typeof password !== 'string' || !password.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '密码登录必须提供 password 字段',
      });
    }

    return password;
  }

  /**
   * 根据输入内容判断是用户名、邮箱还是手机号。
   */
  private detectIdentifierType(account: string): PasswordLoginIdentifierType {
    if (account.includes('@')) {
      if (!this.config.allowEmail) {
        throw new OmniAuthError({
          code: ERROR_CODES.AUTH_INPUT_001,
          message: '当前未启用邮箱密码登录',
        });
      }

      return 'email';
    }

    if (/^\+?\d{6,20}$/.test(account)) {
      if (!this.config.allowPhone) {
        throw new OmniAuthError({
          code: ERROR_CODES.AUTH_INPUT_001,
          message: '当前未启用手机号密码登录',
        });
      }

      return 'phone';
    }

    if (!this.config.allowUsername) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '当前未启用用户名密码登录',
      });
    }

    return 'username';
  }

  /**
   * 获取已初始化的上下文。
   */
  private ensureContext(): ProviderContext {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'Password Provider 尚未初始化',
      });
    }

    return this.context;
  }
}
