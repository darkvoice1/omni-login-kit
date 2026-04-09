import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { EmailCodeProviderConfig } from '../../types/auth-config.js';
import type {
  ProviderAuthResult,
  ProviderContext,
  VerificationRequestResult,
  VerifiableCredentialProvider,
} from '../base/types.js';

/**
 * 邮箱验证码登录 Provider。
 */
export class EmailCodeProvider implements VerifiableCredentialProvider {
  name = 'Email Code Provider';
  type = 'email_code' as const;
  enabled: boolean;
  private readonly config: EmailCodeProviderConfig;
  private context?: ProviderContext;

  constructor(config: EmailCodeProviderConfig) {
    this.config = config;
    this.enabled = config.enabled;
  }

  async initialize(context: ProviderContext): Promise<void> {
    this.context = context;
  }

  async requestCode(input: Record<string, unknown>): Promise<VerificationRequestResult> {
    const context = this.ensureContext();
    const email = this.readEmail(input);

    const result = await context.verificationService.createCodeToken({
      target: email,
      scene: 'login',
      channel: 'email',
      senderName: this.config.sender,
      expiresInSeconds: this.config.expiresInSeconds,
      codeLength: this.config.codeLength,
    });

    // 先通过统一发送器把验证码发出去，后续阶段五再补模板系统。
    await context.messageSenderRegistry.get(this.config.sender).send({
      senderName: this.config.sender,
      channel: 'email',
      target: email,
      subject: '邮箱验证码',
      template: '你的邮箱验证码是：{{code}}，5 分钟内有效。',
      payload: {
        code: result.plainCode,
      },
    });

    return {
      ok: true,
      metadata: {
        target: email,
        senderName: this.config.sender,
      },
    };
  }

  async authenticate(input: Record<string, unknown>): Promise<ProviderAuthResult> {
    const context = this.ensureContext();
    const email = this.readEmail(input);
    const code = this.readCode(input);

    await context.verificationService.verifyToken({
      target: email,
      scene: 'login',
      channel: 'email',
      plainToken: code,
    });

    let identity = await context.identityService.findIdentity('email_code', email);

    if (!identity) {
      const user = await context.identityService.createUser({
        displayName: email,
        email,
        status: 'active',
      });

      identity = await context.identityService.createIdentity({
        userId: user.id,
        providerType: 'email_code',
        providerSubject: email,
        email,
        metadata: {},
      });

      return {
        userId: user.id,
        identityId: identity.id,
        isNewUser: true,
        metadata: {
          loginType: 'email_code',
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
        loginType: 'email_code',
      },
    };
  }

  private readEmail(input: Record<string, unknown>): string {
    const email = input.email;
    if (typeof email !== 'string' || !email.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '邮箱验证码登录必须提供 email 字段',
      });
    }

    return email.trim();
  }

  private readCode(input: Record<string, unknown>): string {
    const code = input.code;
    if (typeof code !== 'string' || !code.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '邮箱验证码登录必须提供 code 字段',
      });
    }

    return code.trim();
  }

  private ensureContext(): ProviderContext {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'Email Code Provider 尚未初始化',
      });
    }

    return this.context;
  }
}
