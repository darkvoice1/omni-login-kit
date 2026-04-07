import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';

/**
 * 把 Node.js 的回调式 scrypt 包装成 Promise 风格，方便在 async 函数里调用。
 */
const scrypt = promisify(scryptCallback);

/**
 * 密码哈希结果统一采用的算法标识。
 */
const PASSWORD_ALGORITHM = 'scrypt';

/**
 * scrypt 导出的字节长度。
 */
const KEY_LENGTH = 64;

/**
 * 密码服务。
 *
 * 这一层专门负责“明文密码 <-> 安全哈希”的转换，
 * 不直接关心用户是谁、从哪里来，也不关心数据库细节。
 */
export class PasswordService {
  /**
   * 对明文密码做哈希，并返回可直接落库的字符串。
   *
   * 返回格式：算法名$盐值$哈希值
   * 这样做的好处是：后续如果要升级算法，存量数据也更容易兼容。
   */
  async hashPassword(plainPassword: string): Promise<{ passwordHash: string; passwordAlgo: string }> {
    this.ensurePlainPassword(plainPassword);

    // 每个密码都生成独立盐值，避免相同密码得到相同哈希结果。
    const salt = randomBytes(16).toString('hex');

    // 使用 scrypt 生成安全哈希。
    const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH);
    const passwordHash = `${PASSWORD_ALGORITHM}$${salt}$${Buffer.from(derivedKey).toString('hex')}`;

    return {
      passwordHash,
      passwordAlgo: PASSWORD_ALGORITHM,
    };
  }

  /**
   * 校验明文密码和已存储哈希是否匹配。
   */
  async verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
    this.ensurePlainPassword(plainPassword);

    const parsedHash = this.parseStoredHash(storedHash);
    if (parsedHash.algorithm !== PASSWORD_ALGORITHM) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_CREDENTIALS_001,
        message: `暂不支持的密码算法：${parsedHash.algorithm}`,
      });
    }

    // 根据存储时的盐值重新计算哈希，再做常量时间比较，减少时序攻击风险。
    const derivedKey = await scrypt(plainPassword, parsedHash.salt, KEY_LENGTH);
    const incomingHashBuffer = Buffer.from(derivedKey);
    const storedHashBuffer = Buffer.from(parsedHash.hash, 'hex');

    if (incomingHashBuffer.length !== storedHashBuffer.length) {
      return false;
    }

    return timingSafeEqual(incomingHashBuffer, storedHashBuffer);
  }

  /**
   * 校验明文密码是否满足最基本要求。
   *
   * 当前先做最小约束：不能为空且长度不少于 8。
   * 更复杂的密码规则可以在后续阶段继续补充。
   */
  private ensurePlainPassword(plainPassword: string): void {
    if (!plainPassword || plainPassword.trim().length < 8) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_INPUT_001,
        message: '密码不能为空，且长度不能少于 8 位',
      });
    }
  }

  /**
   * 解析数据库里保存的密码哈希字符串。
   */
  private parseStoredHash(storedHash: string): {
    algorithm: string;
    salt: string;
    hash: string;
  } {
    const parts = storedHash.split('$');
    if (parts.length !== 3) {
      throw new OmniAuthError({
        code: ERROR_CODES.AUTH_CREDENTIALS_001,
        message: '密码哈希格式不合法',
      });
    }

    return {
      algorithm: parts[0],
      salt: parts[1],
      hash: parts[2],
    };
  }
}
