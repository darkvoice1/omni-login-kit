import { randomUUID } from 'node:crypto';
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

    // 密码校验通过后，再查统一用户主体，确认这个身份最终归属于谁。
    const user = await context.identityService.findUserById(identity.userId);
    if (!user) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_001,
        message: '用户不存在',
        statusCode: 404,
      });
    }

    // 被禁用的用户不允许继续登录。
    if (user.status === 'disabled') {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_002,
        message: '用户已被禁用',
        statusCode: 403,
      });
    }

    // 这一小步先把用户状态校验补齐，并记录最后登录时间。
    await context.identityService.touchLastLogin(user.id);

    return {
      userId: user.id,
      identityId: identity.id,
      isNewUser: false,
      metadata: {
        identifierType,
      },
    };
  }

  /**
   * 执行本地账号注册。
   */
  async register(input: Record<string, unknown>): Promise<ProviderAuthResult> {
    const context = this.ensureContext();
    const account = this.readAccount(input);
    const password = this.readPassword(input);
    const displayName = this.readDisplayName(input, account);
    const identifierType = this.detectIdentifierType(account);

    // 注册前先检查当前账号标识是否已被占用。
    await this.ensureRegistrationIdentifierAvailable(context, identifierType, account);

    // 先生成密码哈希，再进入事务创建用户、身份和凭证。
    const passwordPayload = await context.passwordService.hashPassword(password);
    return context.storage.transaction(async (storage) => {
      const user = await storage.users.create({
        displayName,
        email: identifierType === 'email' ? account : undefined,
        phone: identifierType === 'phone' ? account : undefined,
        status: 'active',
      });

      const identity = await storage.identities.create({
        userId: user.id,
        providerType: 'password',
        providerSubject: randomUUID(),
        username: identifierType === 'username' ? account : undefined,
        email: identifierType === 'email' ? account : undefined,
        phone: identifierType === 'phone' ? account : undefined,
        metadata: {},
      });

      await storage.credentials.upsertPasswordHash(
        identity.id,
        passwordPayload.passwordHash,
        passwordPayload.passwordAlgo,
      );

      return {
        userId: user.id,
        identityId: identity.id,
        isNewUser: true,
        metadata: {
          identifierType,
        },
      };
    });
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
   * 读取注册展示名；如果没传，就回退到账号本身。
   */
  private readDisplayName(input: Record<string, unknown>, fallbackAccount: string): string {
    const displayName = input.displayName;
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return fallbackAccount;
    }

    return displayName.trim();
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
   * 在注册前检查账号标识是否已被占用。
   */
  private async ensureRegistrationIdentifierAvailable(
    context: ProviderContext,
    identifierType: PasswordLoginIdentifierType,
    identifierValue: string,
  ): Promise<void> {
    const existingIdentity = await context.storage.identities.findPasswordIdentityByIdentifier({
      identifierType,
      identifierValue,
    });

    if (existingIdentity) {
      throw this.createIdentifierConflictError(identifierType);
    }

    if (identifierType === 'email') {
      const existingUser = await context.identityService.findUserByEmail(identifierValue);
      if (existingUser) {
        throw this.createIdentifierConflictError(identifierType);
      }
    }

    if (identifierType === 'phone') {
      const existingUser = await context.identityService.findUserByPhone(identifierValue);
      if (existingUser) {
        throw this.createIdentifierConflictError(identifierType);
      }
    }
  }

  /**
   * 根据不同账号类型创建更明确的重复占用错误。
   */
  private createIdentifierConflictError(identifierType: PasswordLoginIdentifierType): OmniAuthError {
    switch (identifierType) {
      case 'username':
        return new OmniAuthError({
          code: ERROR_CODES.USER_USERNAME_001,
          message: '用户名已被占用',
          statusCode: 409,
        });
      case 'email':
        return new OmniAuthError({
          code: ERROR_CODES.USER_EMAIL_001,
          message: '邮箱已被占用',
          statusCode: 409,
        });
      case 'phone':
        return new OmniAuthError({
          code: ERROR_CODES.USER_PHONE_001,
          message: '手机号已被占用',
          statusCode: 409,
        });
      default:
        return new OmniAuthError({
          code: ERROR_CODES.AUTH_INPUT_001,
          message: '账号标识类型不合法',
        });
    }
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
