import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type {
  OmniAuthConfig,
  SenderConfig,
  SmtpSenderConfig,
  AliyunSmsSenderConfig,
  TencentSmsSenderConfig,
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
 * 腾讯云短信请求最小结构。
 */
export interface TencentSmsRequestLike {
  PhoneNumberSet?: string[];
  SmsSdkAppId?: string;
  SignName?: string;
  TemplateId?: string;
  TemplateParamSet?: string[];
}

/**
 * 腾讯云短信客户端最小接口。
 */
export interface TencentSmsClientLike {
  SendSms(request: TencentSmsRequestLike): Promise<{
    SendStatusSet?: Array<{
      Code?: string;
      Message?: string;
    }>;
  }>;
}

type TencentSmsClientCtor = new (config: unknown) => TencentSmsClientLike;

interface TencentSdkModules {
  clientCtor: TencentSmsClientCtor;
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
    if (this.clientOverride) {
      // 测试注入 fake client 时不依赖阿里云 SDK，避免可选依赖缺失导致单测失败。
      return {
        phoneNumbers: input.target,
        signName: this.config.signName,
        templateCode: this.config.templateCode,
        templateParam: JSON.stringify(input.payload),
      };
    }

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
 * 腾讯云短信发送器。
 *
 * 关键策略：仅在真实发送短信时动态加载腾讯云 SDK。
 */
export class TencentSmsMessageSender implements MessageSender {
  private readonly senderName: string;
  private readonly config: TencentSmsSenderConfig;
  private readonly clientOverride?: TencentSmsClientLike;
  private clientPromise?: Promise<TencentSmsClientLike>;
  private static sdkModulesPromise?: Promise<TencentSdkModules>;

  /**
   * 初始化发送器。
   *
   * `client` 仅用于测试注入 fake client。
   */
  constructor(senderName: string, config: TencentSmsSenderConfig, client?: TencentSmsClientLike) {
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
        message: `腾讯云短信发送器 ${this.senderName} 只支持 sms 通道`,
      });
    }

    try {
      const client = await this.getClient();
      const request = this.createSendSmsRequest(input);
      const response = await client.SendSms(request);
      const statuses = response.SendStatusSet ?? [];

      if (!statuses.length || statuses.some((item) => item.Code !== 'Ok')) {
        const message = statuses.find((item) => item.Code !== 'Ok')?.Message ?? '未知错误';
        throw new OmniAuthError({
          code: ERROR_CODES.PROVIDER_RUNTIME_001,
          message: `腾讯云短信发送失败：${message}`,
        });
      }
    } catch (error) {
      if (error instanceof OmniAuthError) {
        throw error;
      }

      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_RUNTIME_001,
        message: `腾讯云短信发送失败：${this.senderName}`,
        cause: error,
      });
    }
  }

  /**
   * 获取短信客户端（懒初始化）。
   */
  private async getClient(): Promise<TencentSmsClientLike> {
    if (this.clientOverride) {
      return this.clientOverride;
    }

    if (!this.clientPromise) {
      this.clientPromise = this.createClientFromConfig();
    }

    return this.clientPromise;
  }

  /**
   * 基于配置动态创建腾讯云客户端。
   */
  private async createClientFromConfig(): Promise<TencentSmsClientLike> {
    const sdkModules = await TencentSmsMessageSender.loadSdkModules();
    return new sdkModules.clientCtor({
      credential: {
        secretId: this.config.secretId,
        secretKey: this.config.secretKey,
      },
      region: this.config.region ?? 'ap-guangzhou',
      profile: {
        httpProfile: {
          endpoint: 'sms.tencentcloudapi.com',
        },
      },
    });
  }

  /**
   * 组装腾讯云短信请求。
   */
  private createSendSmsRequest(input: SendMessageInput): TencentSmsRequestLike {
    return {
      PhoneNumberSet: [normalizePhoneForTencent(input.target)],
      SmsSdkAppId: this.config.smsSdkAppId,
      SignName: this.config.signName,
      TemplateId: this.config.templateId,
      TemplateParamSet: Object.values(input.payload),
    };
  }

  /**
   * 动态加载腾讯云 SDK，并做模块级缓存。
   */
  private static async loadSdkModules(): Promise<TencentSdkModules> {
    if (!this.sdkModulesPromise) {
      this.sdkModulesPromise = (async () => {
        try {
          const tencentSmsModule = await import('tencentcloud-sdk-nodejs-sms');
          const clientCtor = this.extractTencentClientCtor(tencentSmsModule);

          if (typeof clientCtor !== 'function') {
            throw new Error('腾讯云短信 SDK 导出结构不符合预期');
          }

          return {
            clientCtor,
          };
        } catch (error) {
          throw new OmniAuthError({
            code: ERROR_CODES.PROVIDER_RUNTIME_001,
            message: '腾讯云短信 SDK 未安装或加载失败。启用 tencent_sms 发送器前，请安装 tencentcloud-sdk-nodejs-sms',
            cause: error,
          });
        }
      })();
    }

    return this.sdkModulesPromise;
  }

  /**
   * 提取腾讯云 SDK 的短信客户端构造器。
   */
  private static extractTencentClientCtor(moduleValue: unknown): TencentSmsClientCtor | null {
    const moduleWithDefault = moduleValue as { default?: unknown };
    const namespace = moduleWithDefault.default ?? moduleValue;
    const sdkRoot = namespace as {
      sms?: {
        v20210111?: {
          Client?: unknown;
        };
      };
    };

    const clientCtor = sdkRoot.sms?.v20210111?.Client;
    return typeof clientCtor === 'function' ? (clientCtor as TencentSmsClientCtor) : null;
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
    case 'tencent_sms':
      return new TencentSmsMessageSender(senderName, config);
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

/**
 * 规范化腾讯云短信手机号格式。
 */
function normalizePhoneForTencent(phone: string): string {
  const normalized = phone.trim();
  if (normalized.startsWith('+')) {
    return normalized;
  }

  if (/^\d{6,20}$/.test(normalized)) {
    return `+86${normalized}`;
  }

  return normalized;
}
