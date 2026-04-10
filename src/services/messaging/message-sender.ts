import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type {
  OmniAuthConfig,
  SenderConfig,
  SmtpSenderConfig,
  AliyunSmsSenderConfig,
} from '../../types/auth-config.js';

/**
 * 发送通道类型。
 */
export type MessageChannel = 'email' | 'sms';

/**
 * 统一发送入参。
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
 * 发送器接口。
 */
export interface MessageSender {
  send(input: SendMessageInput): Promise<void>;
}

/**
 * 阿里云短信请求最小结构。
 */
export interface AliyunSendSmsRequestLike {
  phoneNumbers?: string;
  signName?: string;
  templateCode?: string;
  templateParam?: string;
}

/**
 * 阿里云短信客户端最小接口。
 *
 * 单独抽出接口是为了测试可注入 fake client。
 */
export interface AliyunSmsClientLike {
  sendSms(request: AliyunSendSmsRequestLike): Promise<{
    body?: {
      code?: string;
      message?: string;
    };
  }>;
}

type AliyunSmsClientCtor = new (config: unknown) => AliyunSmsClientLike;
type AliyunSendSmsRequestCtor = new (input: {
  phoneNumbers: string;
  signName: string;
  templateCode: string;
  templateParam: string;
}) => AliyunSendSmsRequestLike;
type AliyunOpenApiConfigCtor = new (input: {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
}) => unknown;

interface AliyunSdkModules {
  clientCtor: AliyunSmsClientCtor;
  sendSmsRequestCtor: AliyunSendSmsRequestCtor;
  openApiConfigCtor: AliyunOpenApiConfigCtor;
}

/**
 * SMTP 邮件发送器。
 */
export class SmtpMessageSender implements MessageSender {
  private readonly senderName: string;
  private readonly config: SmtpSenderConfig;
  private readonly transporter: Transporter;

  /**
   * 初始化 SMTP 连接配置。
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
   * 发送邮件。
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
 * 阿里云短信发送器。
 *
 * 关键策略：只有真正发送短信时才动态加载阿里云 SDK。
 */
export class AliyunSmsMessageSender implements MessageSender {
  private readonly senderName: string;
  private readonly config: AliyunSmsSenderConfig;
  private readonly clientOverride?: AliyunSmsClientLike;
  private clientPromise?: Promise<AliyunSmsClientLike>;
  private static sdkModulesPromise?: Promise<AliyunSdkModules>;

  /**
   * 初始化发送器。
   *
   * `client` 仅用于测试注入 fake client。
   */
  constructor(senderName: string, config: AliyunSmsSenderConfig, client?: AliyunSmsClientLike) {
    this.senderName = senderName;
    this.config = config;
    this.clientOverride = client;
  }

  /**
   * 发送短信。
   */
  async send(input: SendMessageInput): Promise<void> {
    if (input.channel !== 'sms') {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_RUNTIME_001,
        message: `阿里云短信发送器 ${this.senderName} 只支持 sms 通道`,
      });
    }

    try {
      const client = await this.getClient();
      const request = await this.createSendSmsRequest(input);
      const response = await client.sendSms(request);
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

  /**
   * 获取短信客户端（懒初始化）。
   */
  private async getClient(): Promise<AliyunSmsClientLike> {
    if (this.clientOverride) {
      return this.clientOverride;
    }

    if (!this.clientPromise) {
      this.clientPromise = this.createClientFromConfig();
    }

    return this.clientPromise;
  }

  /**
   * 基于配置动态创建阿里云客户端。
   */
  private async createClientFromConfig(): Promise<AliyunSmsClientLike> {
    const sdkModules = await AliyunSmsMessageSender.loadSdkModules();
    const openApiConfig = new sdkModules.openApiConfigCtor({
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      endpoint: 'dysmsapi.aliyuncs.com',
    });

    return new sdkModules.clientCtor(openApiConfig);
  }

  /**
   * 构建发送请求对象。
   */
  private async createSendSmsRequest(input: SendMessageInput): Promise<AliyunSendSmsRequestLike> {
    const sdkModules = await AliyunSmsMessageSender.loadSdkModules();

    return new sdkModules.sendSmsRequestCtor({
      phoneNumbers: input.target,
      signName: this.config.signName,
      templateCode: this.config.templateCode,
      templateParam: JSON.stringify(input.payload),
    });
  }

  /**
   * 动态加载阿里云 SDK，并做模块级缓存。
   */
  private static async loadSdkModules(): Promise<AliyunSdkModules> {
    if (!this.sdkModulesPromise) {
      this.sdkModulesPromise = (async () => {
        try {
          const [aliyunSmsModule, aliyunOpenApiModule] = await Promise.all([
            import('@alicloud/dysmsapi20170525'),
            import('@alicloud/openapi-client'),
          ]);

          const clientCtor = (aliyunSmsModule.default ?? aliyunSmsModule) as unknown as AliyunSmsClientCtor;
          const sendSmsRequestCtor = aliyunSmsModule.SendSmsRequest as AliyunSendSmsRequestCtor;
          const openApiConfigCtor = aliyunOpenApiModule.Config as AliyunOpenApiConfigCtor;

          if (
            typeof clientCtor !== 'function' ||
            typeof sendSmsRequestCtor !== 'function' ||
            typeof openApiConfigCtor !== 'function'
          ) {
            throw new Error('阿里云短信 SDK 导出结构不符合预期');
          }

          return {
            clientCtor,
            sendSmsRequestCtor,
            openApiConfigCtor,
          };
        } catch (error) {
          throw new OmniAuthError({
            code: ERROR_CODES.PROVIDER_RUNTIME_001,
            message:
              '阿里云短信 SDK 未安装或加载失败。启用 aliyun_sms 发送器前，请安装 @alicloud/dysmsapi20170525 和 @alicloud/openapi-client',
            cause: error,
          });
        }
      })();
    }

    return this.sdkModulesPromise;
  }
}

/**
 * 发送器注册表。
 */
export class MessageSenderRegistry {
  private readonly senders = new Map<string, MessageSender>();

  /**
   * 根据配置创建并注册发送器。
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
   * 注册发送器实例。
   */
  register(senderName: string, sender: MessageSender): void {
    this.senders.set(senderName, sender);
  }

  /**
   * 获取发送器实例。
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
 * 根据配置创建具体发送器。
 */
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

/**
 * 渲染纯文本模板变量。
 */
function renderPlainTextTemplate(template: string, payload: Record<string, string>): string {
  let content = template;

  for (const [key, value] of Object.entries(payload)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  return content;
}

