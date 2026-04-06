import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { SessionConfig } from '../../types/auth-config.js';

/**
 * Access Token 负载结构。
 */
export interface AccessTokenPayload {
  sub: string;
  sid: string;
  type: 'access_token';
}

/**
 * 会话签发结果。
 */
export interface SessionTokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

/**
 * 负责管理 Access Token 和 Refresh Session。
 */
export class SessionManager {
  private readonly sessionConfig: SessionConfig;
  private readonly storage: StorageAdapter;

  /**
   * 创建会话管理器。
   */
  constructor(sessionConfig: SessionConfig, storage: StorageAdapter) {
    this.sessionConfig = sessionConfig;
    this.storage = storage;
  }

  /**
   * 为指定用户签发一组新的登录态。
   */
  async createSessionTokens(input: {
    userId: string;
    deviceInfo?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<SessionTokenPair> {
    // 先生成刷新令牌，并把哈希值写入持久化存储。
    const refreshToken = randomUUID();
    const refreshTokenHash = this.hashValue(refreshToken);
    const session = await this.storage.sessions.create({
      userId: input.userId,
      refreshTokenHash,
      deviceInfo: input.deviceInfo,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      expiresAt: new Date(Date.now() + this.parseDurationToMs(this.sessionConfig.refreshTokenTtl)),
    });

    // 再基于用户和会话生成短期 Access Token。
    const accessToken = jwt.sign(
      {
        sub: input.userId,
        sid: session.id,
        type: 'access_token',
      } satisfies AccessTokenPayload,
      this.sessionConfig.secret,
      {
        issuer: this.sessionConfig.issuer,
        audience: this.sessionConfig.audience,
        expiresIn: this.sessionConfig.accessTokenTtl,
      },
    );

    return {
      accessToken,
      refreshToken,
      sessionId: session.id,
    };
  }

  /**
   * 校验 Access Token 的有效性。
   */
  verifyAccessToken(accessToken: string): AccessTokenPayload {
    try {
      return jwt.verify(accessToken, this.sessionConfig.secret, {
        issuer: this.sessionConfig.issuer,
        audience: this.sessionConfig.audience,
      }) as AccessTokenPayload;
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.SESSION_ACCESS_001,
        message: 'Access Token 无效',
        statusCode: 401,
        cause: error,
      });
    }
  }

  /**
   * 撤销刷新会话。
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.storage.sessions.revoke(sessionId, new Date());
  }

  /**
   * 计算敏感值哈希。
   */
  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * 把简单时长字符串转换为毫秒数。
   */
  private parseDurationToMs(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());

    if (!match) {
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_SESSION_001,
        message: `无法解析时长配置：${value}`,
      });
    }

    const amount = Number(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60 * 1000;
      case 'h':
        return amount * 60 * 60 * 1000;
      case 'd':
        return amount * 24 * 60 * 60 * 1000;
      default:
        throw new OmniAuthError({
          code: ERROR_CODES.CFG_SESSION_001,
          message: `不支持的时长单位：${unit}`,
        });
    }
  }
}
