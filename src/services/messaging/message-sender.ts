import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { OmniAuthConfig, SenderConfig, SmtpSenderConfig } from '../../types/auth-config.js';

/**
 * 支持的消息发送通道。
 */
export type MessageChannel = 'email' | 'sms';

/**
 * 统一消息发送输入。
 */
export interface SendMessageInput {
  senderName: string;
  channel: MessageChannel;
  target: string;
  subject?: string;
  template: string;
  payload: Record<string, string>;
}

/**
 * 统一消息发送器接口。
 */
export interface MessageSender {
  send(input: SendMessageInput): Promise<void>;
}

/**
 * SMTP 消息发送器。
 */
export class SmtpMessageSender implements MessageSender {
  private readonly senderName: string;
  private readonly config: SmtpSenderConfig;
  private readonly transporter: Transporter;

  /**
   * 创建 SMTP 发送器。
   */
  constructor(senderName: string, config: SmtpSenderConfig) {
    this.senderName = senderName;
    this.config = config;
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }

  /**
   * 发送邮件消息。
   */
  async send(input: SendMessageInput): Promise<void> {
    if (input.channel !== 'email') {
      throw new OmniAuthError({
        code: ERROR_CODES.EMAIL_SEND_001,
        message: `SMTP 发送器 ${this.senderName} 只支持 email 通道`,
      });
    }

    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: input.target,
        subject: input.subject ?? '验证码',
        text: renderPlainTextTemplate(input.template, input.payload),
      });
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.EMAIL_SEND_001,
        message: `SMTP 发送失败：${this.senderName}`,
        cause: error,
      });
    }
  }
}

/**
 * 统一消息发送器注册表。
 */
export class MessageSenderRegistry {
  private readonly senders = new Map<string, MessageSender>();

  /**
   * 根据配置创建发送器注册表。
   */
  static fromConfig(config: OmniAuthConfig): MessageSenderRegistry {
    const registry = new MessageSenderRegistry();
    const senderEntries = Object.entries(config.senders ?? {});

    for (const [senderName, senderConfig] of senderEntries) {
      registry.register(senderName, createSenderByConfig(senderName, senderConfig));
    }

    return registry;
  }

  /**
   * 注册消息发送器。
   */
  register(senderName: string, sender: MessageSender): void {
    this.senders.set(senderName, sender);
  }

  /**
   * 获取消息发送器。
   */
  get(senderName: string): MessageSender {
    const sender = this.senders.get(senderName);
    if (!sender) {
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_SENDER_001,
        message: `未找到发送器：${senderName}`,
      });
    }

    return sender;
  }
}

/**
 * 根据配置类型创建具体发送器。
 */
function createSenderByConfig(senderName: string, config: SenderConfig): MessageSender {
  switch (config.type) {
    case 'smtp':
      return new SmtpMessageSender(senderName, config);
    case 'aliyun_sms':
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_RUNTIME_001,
        message: `发送器 ${senderName} 的 aliyun_sms 实现将在后续阶段补齐`,
      });
    default:
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_SENDER_001,
        message: `未支持的发送器类型`,
      });
  }
}

/**
 * 把模板和变量渲染成纯文本内容。
 */
function renderPlainTextTemplate(template: string, payload: Record<string, string>): string {
  let content = template;

  for (const [key, value] of Object.entries(payload)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  return content;
}
