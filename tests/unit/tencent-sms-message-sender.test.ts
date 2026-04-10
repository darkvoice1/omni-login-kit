import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import {
  TencentSmsMessageSender,
  type TencentSmsClientLike,
  type TencentSmsRequestLike,
} from '../../src/services/messaging/message-sender.js';
import type { TencentSmsSenderConfig } from '../../src/types/auth-config.js';

/**
 * 腾讯云短信发送器单元测试。
 */
describe('TencentSmsMessageSender', () => {
  const senderConfig: TencentSmsSenderConfig = {
    type: 'tencent_sms',
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
    smsSdkAppId: '1400000000',
    signName: 'TEST_SIGN',
    templateId: '1234567',
    region: 'ap-guangzhou',
  };

  /**
   * 测试成功发送路径。
   */
  it('应该正确组装短信请求并调用发送方法', async () => {
    let capturedRequest: TencentSmsRequestLike | undefined;

    const fakeClient: TencentSmsClientLike = {
      SendSms: async (request) => {
        capturedRequest = request;
        return {
          SendStatusSet: [
            {
              Code: 'Ok',
              Message: 'send success',
            },
          ],
        };
      },
    };

    const sender = new TencentSmsMessageSender('tencent-sms', senderConfig, fakeClient);
    await sender.send({
      senderName: 'tencent-sms',
      channel: 'sms',
      target: '13800001111',
      template: '你的验证码是：{{code}}',
      payload: {
        code: '123456',
      },
    });

    assert.ok(capturedRequest);
    assert.deepEqual(capturedRequest?.PhoneNumberSet, ['+8613800001111']);
    assert.equal(capturedRequest?.SmsSdkAppId, '1400000000');
    assert.equal(capturedRequest?.SignName, 'TEST_SIGN');
    assert.equal(capturedRequest?.TemplateId, '1234567');
    assert.deepEqual(capturedRequest?.TemplateParamSet, ['123456']);
  });

  /**
   * 测试腾讯云返回失败码时应抛统一错误。
   */
  it('应该在腾讯云返回非 Ok 状态时抛错', async () => {
    const fakeClient: TencentSmsClientLike = {
      SendSms: async () => ({
        SendStatusSet: [
          {
            Code: 'LimitExceeded.PhoneNumberDailyLimit',
            Message: '触发限流',
          },
        ],
      }),
    };

    const sender = new TencentSmsMessageSender('tencent-sms', senderConfig, fakeClient);

    await assert.rejects(
      async () => {
        await sender.send({
          senderName: 'tencent-sms',
          channel: 'sms',
          target: '13800001111',
          template: '你的验证码是：{{code}}',
          payload: {
            code: '123456',
          },
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'PROVIDER_RUNTIME_001');
        return true;
      },
    );
  });

  /**
   * 测试错误通道会被直接拒绝。
   */
  it('应该拒绝非 sms 通道输入', async () => {
    const fakeClient: TencentSmsClientLike = {
      SendSms: async () => ({
        SendStatusSet: [
          {
            Code: 'Ok',
            Message: 'send success',
          },
        ],
      }),
    };

    const sender = new TencentSmsMessageSender('tencent-sms', senderConfig, fakeClient);

    await assert.rejects(
      async () => {
        await sender.send({
          senderName: 'tencent-sms',
          channel: 'email',
          target: 'test@example.com',
          template: '你的验证码是：{{code}}',
          payload: {
            code: '123456',
          },
        });
      },
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'PROVIDER_RUNTIME_001');
        return true;
      },
    );
  });
});
