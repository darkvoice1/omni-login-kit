import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { SmsProviderConfig } from '../../types/auth-config.js';
import type {
  ProviderAuthResult,
  ProviderContext,
  VerificationRequestResult,
  VerifiableCredentialProvider,
} from '../base/types.js';

/**
 * 短信验证码登录 Provider。
 */
export class SmsProvider implements VerifiableCredentialProvider {
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
   * 发送短信验证码。
   *
   * 当前阶段先把验证码生成和落库打通，返回调试元信息，
   * 后续阶段七再把真实短信服务商接进来。
   */
  async requestCode(input: Record<string, unknown>): Promise<VerificationRequestResult> {
    const context = this.ensureContext();
    const phone = this.readPhone(input);

    const result = await context.verificationService.createCodeToken({
      target: phone,
      scene: 'login',
      channel: 'sms',
      senderName: this.config.sender,
      expiresInSeconds: this.config.expiresInSeconds,
      codeLength: this.config.codeLength,
    });

    return {
      ok: true,
      metadata: {
        target: phone,
        senderName: this.config.sender,
        plainCode: result.plainCode,
      },
    };
  }

  /**
   * 执行短信验证码登录。
   */
  async authenticate(input: Record<string, unknown>): Promise<ProviderAuthResult> {
    const context = this.ensureContext();
    const phone = this.readPhone(input);
    const code = this.readCode(input);

    // 先校验验证码本身是否正确且未过期。
    await context.verificationService.verifyToken({
      target: phone,
      scene: 'login',
      channel: 'sms',
      plainToken: code,
    });

    // 校验通过后先查是否已有短信验证码身份。
    let identity = await context.identityService.findIdentity('sms', phone);

    // 短信验证码登录也采用“无密码轻注册”策略：如果没有账号，就自动创建。
    if (!identity) {
      const user = await context.identityService.createUser({
        displayName: phone,
        phone,
        status: 'active',
      });

      identity = await context.identityService.createIdentity({
        userId: user.id,
        providerType: 'sms',
        providerSubject: phone,
        phone,
        metadata: {},
      });

      return {
        userId: user.id,
        identityId: identity.id,
        isNewUser: true,
        metadata: {
          loginType: 'sms',
        },
      };
    }

    const user = await context.identityService.findUserById(identity.userId);
    if (!user) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_001,
        message: '用户不存在',
        statusCode: 404,
      });
    }

    if (user.status === 'disabled') {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_USER_002,
        message: '用户已被禁用',
        statusCode: 403,
      });
    }

    await context.identityService.touchLastLogin(user.id);

    return {
      userId: user.id,
      identityId: identity.id,
      isNewUser: false,
      metadata: {
        loginType: 'sms',
      },
    };
  }

  /**
   * 读取并校验手机号字段。
   */
  private readPhone(input: Record<string, unknown>): string {
    const phone = input.phone;
    if (typeof phone !== 'string' || !phone.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '短信验证码登录必须提供 phone 字段',
      });
    }

    const normalizedPhone = phone.trim();
    if (!/^\+?\d{6,20}$/.test(normalizedPhone)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '手机号格式不合法',
      });
    }

    return normalizedPhone;
  }

  /**
   * 读取并校验验证码字段。
   */
  private readCode(input: Record<string, unknown>): string {
    const code = input.code;
    if (typeof code !== 'string' || !code.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '短信验证码登录必须提供 code 字段',
      });
    }

    return code.trim();
  }

  /**
   * 获取已初始化的上下文。
   */
  private ensureContext(): ProviderContext {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'SMS Provider 尚未初始化',
      });
    }

    return this.context;
  }
}
