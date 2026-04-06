import type { ErrorCode } from './error-codes.js';

/**
 * 插件内部统一错误对象。
 */
export class OmniAuthError extends Error {
  code: ErrorCode;
  statusCode: number;
  cause?: unknown;

  /**
   * 创建一个统一格式的业务错误。
   */
  constructor(options: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'OmniAuthError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 400;
    this.cause = options.cause;
  }
}
