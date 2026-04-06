import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type {
  BaseOAuthProviderConfig,
  OmniAuthConfig,
  ProviderConfig,
  SenderConfig,
} from '../types/auth-config.js';

/**
 * 校验并返回标准化后的认证配置。
 */
export function loadAuthConfig(config: OmniAuthConfig): OmniAuthConfig {
  // 先校验顶层关键字段，避免后续运行时才暴露问题。
  ensureNonEmptyString(config.appName, ERROR_CODES.AUTH_INPUT_001, 'appName 不能为空');
  ensureValidUrl(config.baseUrl);
  ensureRoutePrefix(config.routePrefix);
  ensureDatabaseConfig(config);
  ensureSessionConfig(config);
  ensureEnabledProviders(config.providers);

  // 再逐个校验 Provider，确保不同登录方式所需字段完整。
  for (const provider of config.providers) {
    validateProviderConfig(provider, config.senders ?? {});
  }

  return config;
}

/**
 * 校验数据库配置。
 */
function ensureDatabaseConfig(config: OmniAuthConfig): void {
  if (!config.database || !config.database.url) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_DATABASE_001,
      message: '数据库配置缺失',
    });
  }
}

/**
 * 校验会话配置。
 */
function ensureSessionConfig(config: OmniAuthConfig): void {
  if (!config.session) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_SESSION_001,
      message: '会话配置缺失',
    });
  }

  ensureNonEmptyString(config.session.secret, ERROR_CODES.CFG_SECRET_001, 'JWT 密钥不能为空');
  ensureNonEmptyString(config.session.accessTokenTtl, ERROR_CODES.CFG_SESSION_001, 'accessTokenTtl 不能为空');
  ensureNonEmptyString(config.session.refreshTokenTtl, ERROR_CODES.CFG_SESSION_001, 'refreshTokenTtl 不能为空');
}

/**
 * 校验是否至少启用了一个 Provider。
 */
function ensureEnabledProviders(providers: ProviderConfig[]): void {
  if (!providers.length || !providers.some((provider) => provider.enabled)) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_PROVIDER_001,
      message: '至少需要启用一个 Provider',
    });
  }
}

/**
 * 校验单个 Provider 配置。
 */
function validateProviderConfig(
  provider: ProviderConfig,
  senders: Record<string, SenderConfig>,
): void {
  if (!provider.enabled) {
    return;
  }

  switch (provider.type) {
    case 'password':
      if (!provider.allowUsername && !provider.allowEmail && !provider.allowPhone) {
        throw new OmniAuthError({
          code: ERROR_CODES.CFG_PROVIDER_001,
          message: '密码登录至少需要启用一种账号标识',
        });
      }
      break;
    case 'email_code':
    case 'email_magic_link':
    case 'sms':
      ensureSenderExists(provider.sender, senders);
      break;
    case 'github':
    case 'google':
    case 'wechat':
      ensureOAuthConfig(provider);
      break;
    default:
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_PROVIDER_001,
        message: `未知的 Provider 类型：${provider.type}`,
      });
  }
}

/**
 * 校验 OAuth Provider 的关键字段。
 */
function ensureOAuthConfig(provider: BaseOAuthProviderConfig): void {
  ensureNonEmptyString(provider.clientId, ERROR_CODES.CFG_OAUTH_001, `${provider.type} 缺少 clientId`);
  ensureNonEmptyString(
    provider.clientSecret,
    ERROR_CODES.CFG_OAUTH_001,
    `${provider.type} 缺少 clientSecret`,
  );
}

/**
 * 校验发送器是否存在。
 */
function ensureSenderExists(senderName: string, senders: Record<string, SenderConfig>): void {
  if (!senders[senderName]) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_SENDER_001,
      message: `未找到发送器配置：${senderName}`,
    });
  }
}

/**
 * 校验 URL 是否合法。
 */
function ensureValidUrl(value: string): void {
  ensureNonEmptyString(value, ERROR_CODES.CFG_BASEURL_001, 'baseUrl 不能为空');

  try {
    new URL(value);
  } catch (error) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_BASEURL_001,
      message: 'baseUrl 必须是合法的 URL',
      cause: error,
    });
  }
}

/**
 * 校验路由前缀是否合法。
 */
function ensureRoutePrefix(value: string): void {
  if (!value.startsWith('/')) {
    throw new OmniAuthError({
      code: ERROR_CODES.CFG_ROUTEPREFIX_001,
      message: 'routePrefix 必须以 / 开头',
    });
  }
}

/**
 * 校验字符串字段是否为空。
 */
function ensureNonEmptyString(
  value: string,
  code: typeof ERROR_CODES[keyof typeof ERROR_CODES],
  message: string,
): void {
  if (!value || !value.trim()) {
    throw new OmniAuthError({
      code,
      message,
    });
  }
}
