import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { EmailMagicLinkProviderConfig } from '../../types/auth-config.js';
import type {
  MagicLinkCredentialProvider,
  ProviderAuthResult,
  ProviderContext,
  VerificationRequestResult,
} from '../base/types.js';

/**
 * 邮箱魔法链接 Provider。
 */
export class EmailMagicLinkProvider implements MagicLinkCredentialProvider {
  name = 'Email Magic Link Provider';
  type = 'email_magic_link' as const;
  enabled: boolean;
  private readonly config: EmailMagicLinkProviderConfig;
  private context?: ProviderContext;

  constructor(config: EmailMagicLinkProviderConfig) {
    this.config = config;
    this.enabled = config.enabled;
  }

  async initialize(context: ProviderContext): Promise<void> {
    this.context = context;
  }

  /**
   * 发送邮箱魔法链接。
   *
   * 当前阶段先把“生成 token + 发邮件”打通，
   * 点击链接后的登录回调消费流程在 authenticate 中实现。
   */
  async requestMagicLink(input: Record<string, unknown>): Promise<VerificationRequestResult> {
    const context = this.ensureContext();
    const email = this.readEmail(input);

    const result = await context.verificationService.createMagicLinkToken({
      target: email,
      scene: 'login',
      senderName: this.config.sender,
      expiresInSeconds: this.config.expiresInSeconds,
    });

    const magicLinkUrl = this.buildMagicLinkUrl(result.plainToken, email);
    await context.messageSenderRegistry.get(this.config.sender).send({
      senderName: this.config.sender,
      channel: 'email',
      target: email,
      subject: '邮箱魔法链接登录',
      template: '点击此链接完成登录：{{magicLink}}',
      payload: {
        magicLink: magicLinkUrl,
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

  /**
   * 消费邮箱魔法链接并完成登录。
   */
  async authenticate(input: Record<string, unknown>): Promise<ProviderAuthResult> {
    const context = this.ensureContext();
    const email = this.readEmail(input);
    const token = this.readToken(input);

    // 先校验魔法链接本身是否有效且未过期。
    await context.verificationService.verifyToken({
      target: email,
      scene: 'login',
      channel: 'magic_link',
      plainToken: token,
    });

    // 魔法链接登录采用无密码轻注册策略：先查身份，没有就自动创建。
    let identity = await context.identityService.findIdentity('email_magic_link', email);
    if (!identity) {
      const user = await context.identityService.createUser({
        displayName: email,
        email,
        status: 'active',
      });

      identity = await context.identityService.createIdentity({
        userId: user.id,
        providerType: 'email_magic_link',
        providerSubject: email,
        email,
        metadata: {},
      });

      return {
        userId: user.id,
        identityId: identity.id,
        isNewUser: true,
        metadata: {
          loginType: 'email_magic_link',
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
        loginType: 'email_magic_link',
      },
    };
  }

  private readEmail(input: Record<string, unknown>): string {
    const email = input.email;
    if (typeof email !== 'string' || !email.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '邮箱魔法链接必须提供 email 字段',
      });
    }

    return email.trim();
  }

  /**
   * 读取并校验魔法链接 token。
   */
  private readToken(input: Record<string, unknown>): string {
    const token = input.token;
    if (typeof token !== 'string' || !token.trim()) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '邮箱魔法链接登录必须提供 token 字段',
      });
    }

    return token.trim();
  }

  private buildMagicLinkUrl(token: string, email: string): string {
    const context = this.ensureContext();
    const url = new URL(`${context.config.baseUrl}${context.config.routePrefix}/email-magic-link/callback`);
    url.searchParams.set('token', token);
    url.searchParams.set('email', email);
    return url.toString();
  }

  private ensureContext(): ProviderContext {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: 'Email Magic Link Provider 尚未初始化',
      });
    }

    return this.context;
  }
}
