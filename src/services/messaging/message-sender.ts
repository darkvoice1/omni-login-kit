import Dysmsapi20170525, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { Config as OpenApiConfig } from '@alicloud/openapi-client';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { OmniAuthConfig, SenderConfig, SmtpSenderConfig, AliyunSmsSenderConfig } from '../../types/auth-config.js';

export type MessageChannel = 'email' | 'sms';

export interface SendMessageInput {
  senderName: string;
  channel: MessageChannel;
  target: string;
  subject?: string;
  template: string;
  payload: Record<string, string>;
}

export interface MessageSender {
  send(input: SendMessageInput): Promise<void>;
}

/**
 * 阿里云短信客户端最小接口。
 *
 * 单独抽出接口的目的是让测试时可以注入 fake client，避免依赖真实 AccessKey。
 */
export interface AliyunSmsClientLike {
  sendSms(request: SendSmsRequest): Promise<{
    body?: {
      code?: string;
      message?: string;
    };
  }>;
}

export class SmtpMessageSender implements MessageSender {
  private readonly senderName: string;
  private readonly config: SmtpSenderConfig;
  private readonly transporter: Transporter;

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

export class AliyunSmsMessageSender implements MessageSender {
  private readonly senderName: string;
  private readonly config: AliyunSmsSenderConfig;
  private readonly client: AliyunSmsClientLike;

  constructor(senderName: string, config: AliyunSmsSenderConfig, client?: AliyunSmsClientLike) {
    this.senderName = senderName;
    this.config = config;
    this.client =
      client ??
      new Dysmsapi20170525(
        new OpenApiConfig({
          accessKeyId: config.accessKeyId,
          accessKeySecret: config.accessKeySecret,
          endpoint: 'dysmsapi.aliyuncs.com',
        }),
      );
  }

  async send(input: SendMessageInput): Promise<void> {
    if (input.channel !== 'sms') {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_RUNTIME_001,
        message: `阿里云短信发送器 ${this.senderName} 只支持 sms 通道`,
      });
    }

    try {
      const request = new SendSmsRequest({
        phoneNumbers: input.target,
        signName: this.config.signName,
        templateCode: this.config.templateCode,
        templateParam: JSON.stringify(input.payload),
      });

      const response = await this.client.sendSms(request);
      const body = response.body;

      if (!body || body.code !== 'OK') {
        throw new OmniAuthError({
          code: ERROR_CODES.PROVIDER_RUNTIME_001,
          message: `阿里云短信发送失败：${body?.message ?? '未知错误'}`,
        });
      }
    } catch (error) {
      if (error instanceof OmniAuthError) {
        throw error;
      }

      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_RUNTIME_001,
        message: `阿里云短信发送失败：${this.senderName}`,
        cause: error,
      });
    }
  }
}

export class MessageSenderRegistry {
  private readonly senders = new Map<string, MessageSender>();

  static fromConfig(config: OmniAuthConfig): MessageSenderRegistry {
    const registry = new MessageSenderRegistry();
    const senderEntries = Object.entries(config.senders ?? {});

    for (const [senderName, senderConfig] of senderEntries) {
      registry.register(senderName, createSenderByConfig(senderName, senderConfig));
    }

    return registry;
  }

  register(senderName: string, sender: MessageSender): void {
    this.senders.set(senderName, sender);
  }

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

function createSenderByConfig(senderName: string, config: SenderConfig): MessageSender {
  switch (config.type) {
    case 'smtp':
      return new SmtpMessageSender(senderName, config);
    case 'aliyun_sms':
      return new AliyunSmsMessageSender(senderName, config);
    default:
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_SENDER_001,
        message: `未支持的发送器类型`,
      });
  }
}

function renderPlainTextTemplate(template: string, payload: Record<string, string>): string {
  let content = template;

  for (const [key, value] of Object.entries(payload)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  return content;
}
