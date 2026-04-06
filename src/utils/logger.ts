/**
 * 日志记录器接口。
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * 基于控制台的默认日志实现。
 */
export class ConsoleLogger implements Logger {
  /**
   * 输出 info 日志。
   */
  info(message: string, meta?: Record<string, unknown>): void {
    console.info('[omni-login-kit][info]', message, meta ?? {});
  }

  /**
   * 输出 warn 日志。
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn('[omni-login-kit][warn]', message, meta ?? {});
  }

  /**
   * 输出 error 日志。
   */
  error(message: string, meta?: Record<string, unknown>): void {
    console.error('[omni-login-kit][error]', message, meta ?? {});
  }

  /**
   * 输出 debug 日志。
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug('[omni-login-kit][debug]', message, meta ?? {});
  }
}

/**
 * 创建默认日志记录器。
 */
export function createLogger(): Logger {
  return new ConsoleLogger();
}
