import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PasswordService } from '../../src/services/password/password-service.js';

/**
 * PasswordService 单元测试。
 */
describe('PasswordService', () => {
  /**
   * 测试密码哈希是否正常生成。
   */
  it('应该生成带算法和盐值的密码哈希', async () => {
    const passwordService = new PasswordService();

    const result = await passwordService.hashPassword('12345678');

    assert.equal(result.passwordAlgo, 'scrypt');
    assert.match(result.passwordHash, /^scrypt\$.+\$.+$/);
    assert.equal(result.passwordHash.includes('12345678'), false);
  });

  /**
   * 测试同一个明文密码多次哈希时，结果应该不同。
   */
  it('应该为相同密码生成不同哈希结果', async () => {
    const passwordService = new PasswordService();

    const first = await passwordService.hashPassword('12345678');
    const second = await passwordService.hashPassword('12345678');

    assert.notEqual(first.passwordHash, second.passwordHash);
  });

  /**
   * 测试正确密码能够校验通过。
   */
  it('应该让正确密码通过校验', async () => {
    const passwordService = new PasswordService();
    const hashed = await passwordService.hashPassword('12345678');

    const isValid = await passwordService.verifyPassword('12345678', hashed.passwordHash);

    assert.equal(isValid, true);
  });

  /**
   * 测试错误密码无法通过校验。
   */
  it('应该拒绝错误密码', async () => {
    const passwordService = new PasswordService();
    const hashed = await passwordService.hashPassword('12345678');

    const isValid = await passwordService.verifyPassword('87654321', hashed.passwordHash);

    assert.equal(isValid, false);
  });
});
