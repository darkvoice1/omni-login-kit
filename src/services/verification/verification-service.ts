import { createHash, randomInt, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { VerificationTokenRecord } from '../../types/entities.js';

/**
 * 验证码发送冷却时间，单位为秒。
 */
const SEND_RATE_LIMIT_SECONDS = 60;

/**
 * 验证码和魔法链接服务。
 */
export class VerificationService {
  private readonly storage: StorageAdapter;

  /**
   * 创建验证码服务实例。
   */
  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /**
   * 创建验证码记录，并返回明文验证码给调用方发送。
   */
  async createCodeToken(input: {
    target: string;
    scene: 'login' | 'bind' | 'reset_password';
    channel: 'email' | 'sms';
    senderName: string;
    expiresInSeconds: number;
    codeLength: number;
  }): Promise<{ plainCode: string; record: VerificationTokenRecord }> {
    // 发送前先做最小频控，防止短时间内重复轰炸同一个目标。
    await this.ensureSendRateAllowed(input.target, input.scene, input.channel);

    const plainCode = this.generateNumericCode(input.codeLength);
    const tokenHash = this.hashValue(plainCode);

    const record = await this.storage.verificationTokens.create({
      scene: input.scene,
      channel: input.channel,
      target: input.target,
      tokenHash,
      codeLength: input.codeLength,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      senderName: input.senderName,
      metadata: {},
    });

    return { plainCode, record };
  }

  /**
   * 创建魔法链接令牌，并返回明文 token。
   */
  async createMagicLinkToken(input: {
    target: string;
    scene: 'login' | 'bind' | 'reset_password';
    senderName: string;
    expiresInSeconds: number;
  }): Promise<{ plainToken: string; record: VerificationTokenRecord }> {
    await this.ensureSendRateAllowed(input.target, input.scene, 'magic_link');

    const plainToken = randomUUID();
    const tokenHash = this.hashValue(plainToken);

    const record = await this.storage.verificationTokens.create({
      scene: input.scene,
      channel: 'magic_link',
      target: input.target,
      tokenHash,
      maxAttempts: 1,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      senderName: input.senderName,
      metadata: {},
    });

    return { plainToken, record };
  }

  /**
   * 校验验证码或魔法链接是否有效。
   */
  async verifyToken(input: {
    target: string;
    scene: 'login' | 'bind' | 'reset_password';
    channel: 'email' | 'sms' | 'magic_link';
    plainToken: string;
  }): Promise<VerificationTokenRecord> {
    const record = await this.storage.verificationTokens.findActiveByTarget(
      input.target,
      input.scene,
      input.channel,
    );

    if (!record) {
      throw new OmniAuthError({
        code: ERROR_CODES.VERIFY_TOKEN_001,
        message: '未找到有效的验证码或链接',
      });
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new OmniAuthError({
        code: ERROR_CODES.VERIFY_CODE_002,
        message: '验证码或链接已过期',
      });
    }

    if (record.attemptCount >= record.maxAttempts) {
      throw new OmniAuthError({
        code: ERROR_CODES.VERIFY_CODE_004,
        message: '验证码尝试次数过多',
      });
    }

    const incomingHash = this.hashValue(input.plainToken);
    if (record.tokenHash !== incomingHash) {
      await this.storage.verificationTokens.incrementAttemptCount(record.id);
      throw new OmniAuthError({
        code: ERROR_CODES.VERIFY_CODE_001,
        message: '验证码或链接无效',
      });
    }

    await this.storage.verificationTokens.consume(record.id, new Date());
    return record;
  }

  /**
   * 校验当前目标是否触发了发送频控。
   */
  private async ensureSendRateAllowed(
    target: string,
    scene: 'login' | 'bind' | 'reset_password',
    channel: 'email' | 'sms' | 'magic_link',
  ): Promise<void> {
    const activeRecord = await this.storage.verificationTokens.findActiveByTarget(target, scene, channel);
    if (!activeRecord) {
      return;
    }

    const cooldownDeadline = activeRecord.createdAt.getTime() + SEND_RATE_LIMIT_SECONDS * 1000;
    if (cooldownDeadline > Date.now()) {
      throw new OmniAuthError({
        code: ERROR_CODES.VERIFY_RATE_001,
        message: '发送过于频繁，请稍后再试',
      });
    }
  }

  /**
   * 生成指定长度的数字验证码。
   */
  private generateNumericCode(length: number): string {
    let code = '';

    for (let index = 0; index < length; index += 1) {
      code += randomInt(0, 10).toString();
    }

    return code;
  }

  /**
   * 对敏感值做哈希，避免明文入库。
   */
  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
