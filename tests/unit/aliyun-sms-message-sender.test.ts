import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import {
  AliyunSmsMessageSender,
  type AliyunSmsClientLike,
  type AliyunSendSmsRequestLike,
} from '../../src/services/messaging/message-sender.js';
import type { AliyunSmsSenderConfig } from '../../src/types/auth-config.js';

/**
 * 阿里云短信发送器单元测试。
 */
describe('AliyunSmsMessageSender', () => {
  const senderConfig: AliyunSmsSenderConfig = {
    type: 'aliyun_sms',
    accessKeyId: 'test-key',
    accessKeySecret: 'test-secret',
    signName: 'TEST_SIGN',
    templateCode: 'SMS_0000001',
  };

  /**
   * 测试成功发送路径。
   */
  it('应该正确组装短信请求并调用发送方法', async () => {
    let capturedRequest: AliyunSendSmsRequestLike | undefined;

    const fakeClient: AliyunSmsClientLike = {
      sendSms: async (request) => {
        capturedRequest = request;
        return {
          body: {
            code: 'OK',
            message: 'OK',
          },
        };
      },
    };

    const sender = new AliyunSmsMessageSender('aliyun-sms', senderConfig, fakeClient);
    await sender.send({
      senderName: 'aliyun-sms',
      channel: 'sms',
      target: '13800001111',
      template: '你的验证码是：{{code}}',
      payload: {
        code: '123456',
      },
    });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest?.phoneNumbers, '13800001111');
    assert.equal(capturedRequest?.signName, 'TEST_SIGN');
    assert.equal(capturedRequest?.templateCode, 'SMS_0000001');
    assert.equal(capturedRequest?.templateParam, JSON.stringify({ code: '123456' }));
  });

  /**
   * 测试阿里云返回失败码时应抛统一错误。
   */
  it('应该在阿里云返回非 OK 状态时抛错', async () => {
    const fakeClient: AliyunSmsClientLike = {
      sendSms: async () => ({
        body: {
          code: 'isv.BUSINESS_LIMIT_CONTROL',
          message: '触发限流',
        },
      }),
    };

    const sender = new AliyunSmsMessageSender('aliyun-sms', senderConfig, fakeClient);

    await assert.rejects(
      async () => {
        await sender.send({
          senderName: 'aliyun-sms',
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
    const fakeClient: AliyunSmsClientLike = {
      sendSms: async () => ({
        body: {
          code: 'OK',
          message: 'OK',
        },
      }),
    };

    const sender = new AliyunSmsMessageSender('aliyun-sms', senderConfig, fakeClient);

    await assert.rejects(
      async () => {
        await sender.send({
          senderName: 'aliyun-sms',
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
