import { ERROR_CODES } from '../errors/error-codes.js';
import { OmniAuthError } from '../errors/omni-auth-error.js';

/**
 * 读取必填环境变量。
 */
export function readRequiredEnv(name: string): string {
  const value = process.env[name];

  // 必填环境变量为空时直接抛错，避免系统带着错误配置启动。
  if (!value || !value.trim()) {
    throw new OmniAuthError({
      code: ERROR_CODES.AUTH_INPUT_001,
      message: `缺少必填环境变量：${name}`,
    });
  }

  return value;
}

/**
 * 读取可选环境变量。
 */
export function readOptionalEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

/**
 * 读取数字类型环境变量。
 */
export function readNumberEnv(name: string, fallback?: number): number {
  const rawValue = process.env[name];

  // 未配置时优先返回默认值，否则抛出缺失错误。
  if (!rawValue || !rawValue.trim()) {
    if (typeof fallback === 'number') {
      return fallback;
    }

    throw new OmniAuthError({
      code: ERROR_CODES.AUTH_INPUT_001,
      message: `缺少必填数字环境变量：${name}`,
    });
  }

  const parsedValue = Number(rawValue);
  if (Number.isNaN(parsedValue)) {
    throw new OmniAuthError({
      code: ERROR_CODES.AUTH_INPUT_001,
      message: `环境变量 ${name} 不是合法数字`,
    });
  }

  return parsedValue;
}
