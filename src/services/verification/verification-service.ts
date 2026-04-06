import { createHash, randomInt, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { VerificationTokenRecord } from '../../types/entities.js';

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
    // 先生成纯数字验证码。
    const plainCode = this.generateNumericCode(input.codeLength);
    const tokenHash = this.hashValue(plainCode);

    // 再把验证码的哈希写入存储，避免明文落库。
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
    // 先生成随机令牌，并对入库值做哈希处理。
    const plainToken = randomUUID();
    const tokenHash = this.hashValue(plainToken);

    // 再把令牌信息写入存储，供回调时一次性消费。
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

    // 先处理过期和次数限制，再做哈希比对。
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

    // 验证通过后立刻消费，保证一次性使用。
    await this.storage.verificationTokens.consume(record.id, new Date());
    return record;
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
