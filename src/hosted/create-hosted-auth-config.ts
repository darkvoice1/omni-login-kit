import { readNumberEnv, readOptionalEnv, readRequiredEnv } from '../config/read-env.js';
import { defineAuthConfig } from '../config/define-auth-config.js';
import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type {
  OmniAuthConfig,
  ProviderConfig,
  ProviderType,
  SecurityConfig,
  SenderConfig,
} from '../types/auth-config.js';

const DEFAULT_PORT = 3000;
const DEFAULT_ROUTE_PREFIX = '/auth';
const DEFAULT_APP_NAME = 'omni-login-kit';
const DEFAULT_ACCESS_TOKEN_TTL = '15m';
const DEFAULT_REFRESH_TOKEN_TTL = '30d';
const DEFAULT_ISSUER = 'omni-login-kit';
const DEFAULT_AUDIENCE = 'omni-login-kit-users';
const DEFAULT_EMAIL_CODE_LENGTH = 6;
const DEFAULT_SMS_CODE_LENGTH = 6;
const DEFAULT_EMAIL_CODE_EXPIRES_IN_SECONDS = 300;
const DEFAULT_EMAIL_MAGIC_LINK_EXPIRES_IN_SECONDS = 900;
const DEFAULT_SMS_EXPIRES_IN_SECONDS = 300;
const DEFAULT_SMTP_SENDER_NAME = 'smtp-default';
const DEFAULT_SMS_SENDER_NAME = 'tencent-sms';
const DEFAULT_WECHAT_SCOPE = ['snsapi_login'];
const DEFAULT_WECOM_SCOPE = ['snsapi_login'];
const DEFAULT_FEISHU_SCOPE = ['contact:user.base:readonly'];

export interface HostedServiceConfig {
  authConfig: OmniAuthConfig;
  runtime: {
    host: string;
    port: number;
    trustProxy: boolean;
  };
}

/**
 * 基于环境变量创建可独立部署的认证服务配置。
 */
export function createHostedServiceConfigFromEnv(): HostedServiceConfig {
  const port = readNumberEnv('PORT', DEFAULT_PORT);
  const host = readOptionalEnv('HOST', '0.0.0.0');
  const baseUrl = readOptionalEnv('AUTH_BASE_URL', `http://localhost:${port}`);
  const routePrefix = readOptionalEnv('AUTH_ROUTE_PREFIX', DEFAULT_ROUTE_PREFIX);
  const baseUrlHost = parseUrlHost(baseUrl);
  const trustedRedirectHosts = dedupeItems([
    baseUrlHost,
    ...readListEnv('AUTH_TRUSTED_REDIRECT_HOSTS'),
  ]);

  const senders: Record<string, SenderConfig> = {};
  const providers: ProviderConfig[] = [];

  providers.push({
    type: 'password',
    enabled: readBooleanEnv('AUTH_PASSWORD_ENABLED', true),
    allowUsername: readBooleanEnv('AUTH_ALLOW_USERNAME', true),
    allowEmail: readBooleanEnv('AUTH_ALLOW_EMAIL', true),
    allowPhone: readBooleanEnv('AUTH_ALLOW_PHONE', true),
  });

  const emailCodeEnabled = readBooleanEnv('AUTH_EMAIL_CODE_ENABLED', false);
  const emailMagicLinkEnabled = readBooleanEnv('AUTH_EMAIL_MAGIC_LINK_ENABLED', false);
  if (emailCodeEnabled || emailMagicLinkEnabled) {
    senders[DEFAULT_SMTP_SENDER_NAME] = {
      type: 'smtp',
      host: readRequiredEnv('SMTP_HOST'),
      port: readNumberEnv('SMTP_PORT', 587),
      user: readRequiredEnv('SMTP_USER'),
      password: readRequiredEnv('SMTP_PASSWORD'),
      from: readRequiredEnv('SMTP_FROM'),
    };
  }

  providers.push({
    type: 'email_code',
    enabled: emailCodeEnabled,
    sender: DEFAULT_SMTP_SENDER_NAME,
    codeLength: readNumberEnv('AUTH_EMAIL_CODE_LENGTH', DEFAULT_EMAIL_CODE_LENGTH),
    expiresInSeconds: readNumberEnv(
      'AUTH_EMAIL_CODE_EXPIRES_IN_SECONDS',
      DEFAULT_EMAIL_CODE_EXPIRES_IN_SECONDS,
    ),
  });

  providers.push({
    type: 'email_magic_link',
    enabled: emailMagicLinkEnabled,
    sender: DEFAULT_SMTP_SENDER_NAME,
    expiresInSeconds: readNumberEnv(
      'AUTH_EMAIL_MAGIC_LINK_EXPIRES_IN_SECONDS',
      DEFAULT_EMAIL_MAGIC_LINK_EXPIRES_IN_SECONDS,
    ),
  });

  const smsEnabled = readBooleanEnv('AUTH_SMS_ENABLED', false);
  const smsSenderName = readOptionalEnv('AUTH_SMS_SENDER', DEFAULT_SMS_SENDER_NAME);
  if (smsEnabled) {
    senders[smsSenderName] = createSmsSenderConfig(smsSenderName);
  }

  providers.push({
    type: 'sms',
    enabled: smsEnabled,
    sender: smsSenderName,
    codeLength: readNumberEnv('AUTH_SMS_CODE_LENGTH', DEFAULT_SMS_CODE_LENGTH),
    expiresInSeconds: readNumberEnv(
      'AUTH_SMS_EXPIRES_IN_SECONDS',
      DEFAULT_SMS_EXPIRES_IN_SECONDS,
    ),
  });

  providers.push(createOAuthProviderConfig('wechat', DEFAULT_WECHAT_SCOPE));
  providers.push(createOAuthProviderConfig('wecom', DEFAULT_WECOM_SCOPE));
  providers.push(createOAuthProviderConfig('feishu', DEFAULT_FEISHU_SCOPE));

  const security: SecurityConfig = {
    trustedRedirectHosts,
    enableAuditLog: readBooleanEnv('AUTH_ENABLE_AUDIT_LOG', true),
  };

  const authConfig = defineAuthConfig({
    appName: readOptionalEnv('APP_NAME', DEFAULT_APP_NAME),
    baseUrl,
    routePrefix,
    database: {
      provider: 'postgres',
      url: readRequiredEnv('DATABASE_URL'),
    },
    session: {
      strategy: 'jwt',
      accessTokenTtl: readOptionalEnv(
        'AUTH_ACCESS_TOKEN_TTL',
        DEFAULT_ACCESS_TOKEN_TTL,
      ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      refreshTokenTtl: readOptionalEnv(
        'AUTH_REFRESH_TOKEN_TTL',
        DEFAULT_REFRESH_TOKEN_TTL,
      ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      issuer: readOptionalEnv('AUTH_ISSUER', DEFAULT_ISSUER),
      audience: readOptionalEnv('AUTH_AUDIENCE', DEFAULT_AUDIENCE),
      secret: readRequiredEnv('AUTH_JWT_SECRET'),
    },
    security,
    providers,
    senders: Object.keys(senders).length > 0 ? senders : undefined,
  });

  return {
    authConfig,
    runtime: {
      host,
      port,
      trustProxy: readBooleanEnv('TRUST_PROXY', true),
    },
  };
}

function createOAuthProviderConfig(
  providerType: Extract<ProviderType, 'wechat' | 'wecom' | 'feishu'>,
  defaultScope: string[],
): ProviderConfig {
  const envPrefix = providerType.toUpperCase();
  const enabled = readBooleanEnv(`AUTH_${envPrefix}_ENABLED`, false);

  return {
    type: providerType,
    enabled,
    clientId: enabled ? readRequiredEnv(`${envPrefix}_CLIENT_ID`) : '',
    clientSecret: enabled ? readRequiredEnv(`${envPrefix}_CLIENT_SECRET`) : '',
    scope: readListEnv(`AUTH_${envPrefix}_SCOPE`, defaultScope),
  };
}

function createSmsSenderConfig(senderName: string): SenderConfig {
  if (senderName === 'aliyun-sms') {
    return {
      type: 'aliyun_sms',
      accessKeyId: readRequiredEnv('ALIYUN_SMS_KEY'),
      accessKeySecret: readRequiredEnv('ALIYUN_SMS_SECRET'),
      signName: readRequiredEnv('ALIYUN_SMS_SIGN'),
      templateCode: readRequiredEnv('ALIYUN_SMS_TEMPLATE'),
    };
  }

  if (senderName === 'tencent-sms') {
    return {
      type: 'tencent_sms',
      secretId: readRequiredEnv('TENCENT_SMS_SECRET_ID'),
      secretKey: readRequiredEnv('TENCENT_SMS_SECRET_KEY'),
      smsSdkAppId: readRequiredEnv('TENCENT_SMS_SDK_APP_ID'),
      signName: readRequiredEnv('TENCENT_SMS_SIGN_NAME'),
      templateId: readRequiredEnv('TENCENT_SMS_TEMPLATE_ID'),
      region: readOptionalEnv('TENCENT_SMS_REGION', 'ap-guangzhou'),
    };
  }

  throw new OmniAuthError({
    code: ERROR_CODES.CFG_SENDER_001,
    message: `AUTH_SMS_SENDER 仅支持 aliyun-sms 或 tencent-sms，当前值为：${senderName}`,
  });
}

function parseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch (error) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_BASEURL_001,
      message: 'AUTH_BASE_URL 必须是合法的 URL',
      cause: error,
    });
  }
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new OmniAuthError({
    code: ERROR_CODES.AUTH_INPUT_001,
    message: `环境变量 ${name} 不是合法的布尔值`,
  });
}

function readListEnv(name: string, fallback: string[] = []): string[] {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return [...fallback];
  }

  return dedupeItems(
    rawValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function dedupeItems(items: string[]): string[] {
  return [...new Set(items)];
}
