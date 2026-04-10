/**
 * 支持的会话策略。
 */
export type SessionStrategy = 'jwt';

/**
 * 支持的时长字符串格式。
 *
 * 例如：15m、30d、1h、60s
 */
export type DurationValue = `${number}${'s' | 'm' | 'h' | 'd'}`;

/**
 * 支持的登录方式类型。
 */
export type ProviderType =
  | 'password'
  | 'email_code'
  | 'email_magic_link'
  | 'sms'
  | 'wechat'
  | 'wecom'
  | 'feishu';

/**
 * 数据库配置。
 */
export interface DatabaseConfig {
  provider: 'postgres';
  url: string;
}

/**
 * 会话配置。
 */
export interface SessionConfig {
  strategy: SessionStrategy;
  accessTokenTtl: DurationValue;
  refreshTokenTtl: DurationValue;
  issuer: string;
  audience: string;
  secret: string;
}

/**
 * UI 主题配置。
 */
export interface UiThemeConfig {
  logoUrl?: string;
  primaryColor?: string;
}

/**
 * UI 配置。
 */
export interface UiConfig {
  mode: 'hosted' | 'headless';
  loginPath?: string;
  theme?: UiThemeConfig;
}

/**
 * 安全配置。
 */
export interface SecurityConfig {
  trustedRedirectHosts: string[];
  enableAuditLog: boolean;
}

/**
 * Provider 配置公共字段。
 */
export interface BaseProviderConfig {
  type: ProviderType;
  enabled: boolean;
}

/**
 * 密码登录配置。
 */
export interface PasswordProviderConfig extends BaseProviderConfig {
  type: 'password';
  allowUsername: boolean;
  allowEmail: boolean;
  allowPhone: boolean;
}

/**
 * 验证码类 Provider 的公共配置。
 */
export interface BaseVerificationProviderConfig extends BaseProviderConfig {
  sender: string;
  expiresInSeconds: number;
}

/**
 * 邮箱验证码登录配置。
 */
export interface EmailCodeProviderConfig extends BaseVerificationProviderConfig {
  type: 'email_code';
  codeLength: number;
}

/**
 * 邮箱魔法链接登录配置。
 */
export interface EmailMagicLinkProviderConfig extends BaseVerificationProviderConfig {
  type: 'email_magic_link';
}

/**
 * 短信验证码登录配置。
 */
export interface SmsProviderConfig extends BaseVerificationProviderConfig {
  type: 'sms';
  codeLength: number;
}

/**
 * OAuth Provider 公共配置。
 */
export interface BaseOAuthProviderConfig extends BaseProviderConfig {
  clientId: string;
  clientSecret: string;
  scope?: string[];
}

/**
 * 企业微信登录配置。
 */
export interface WecomProviderConfig extends BaseOAuthProviderConfig {
  type: 'wecom';
}

/**
 * 飞书登录配置。
 */
export interface FeishuProviderConfig extends BaseOAuthProviderConfig {
  type: 'feishu';
}

/**
 * 微信登录配置。
 */
export interface WechatProviderConfig extends BaseOAuthProviderConfig {
  type: 'wechat';
}

/**
 * 所有 Provider 配置的联合类型。
 */
export type ProviderConfig =
  | PasswordProviderConfig
  | EmailCodeProviderConfig
  | EmailMagicLinkProviderConfig
  | SmsProviderConfig
  | WechatProviderConfig
  | WecomProviderConfig
  | FeishuProviderConfig;

/**
 * SMTP 发送器配置。
 */
export interface SmtpSenderConfig {
  type: 'smtp';
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/**
 * 阿里云短信发送器配置。
 */
export interface AliyunSmsSenderConfig {
  type: 'aliyun_sms';
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

/**
 * 腾讯云短信发送器配置。
 */
export interface TencentSmsSenderConfig {
  type: 'tencent_sms';
  secretId: string;
  secretKey: string;
  smsSdkAppId: string;
  signName: string;
  templateId: string;
  region?: string;
}

/**
 * 所有发送器配置的联合类型。
 */
export type SenderConfig = SmtpSenderConfig | AliyunSmsSenderConfig | TencentSmsSenderConfig;

/**
 * 登录插件总配置。
 */
export interface OmniAuthConfig {
  appName: string;
  baseUrl: string;
  routePrefix: string;
  database: DatabaseConfig;
  session: SessionConfig;
  ui?: UiConfig;
  security?: SecurityConfig;
  providers: ProviderConfig[];
  senders?: Record<string, SenderConfig>;
}
