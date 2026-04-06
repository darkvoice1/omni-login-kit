import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';
import type { ProviderType } from '../types/auth-config.js';
import type { AuthProvider } from '../providers/base/types.js';

/**
 * 负责管理所有 Provider 的注册与读取。
 */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, AuthProvider>();

  /**
   * 注册单个 Provider。
   */
  register(provider: AuthProvider): void {
    // 先检查是否重复注册，避免后续行为不确定。
    if (this.providers.has(provider.type)) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_001,
        message: `Provider 已注册：${provider.type}`,
      });
    }

    this.providers.set(provider.type, provider);
  }

  /**
   * 批量注册 Provider。
   */
  registerMany(providers: AuthProvider[]): void {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  /**
   * 获取指定 Provider。
   */
  get(type: ProviderType): AuthProvider {
    const provider = this.providers.get(type);

    if (!provider) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_PROVIDER_001,
        message: `未找到 Provider：${type}`,
        statusCode: 404,
      });
    }

    return provider;
  }

  /**
   * 列出所有已注册 Provider。
   */
  list(): AuthProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 列出所有已启用 Provider。
   */
  listEnabled(): AuthProvider[] {
    return this.list().filter((provider) => provider.enabled);
  }
}
