import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { OmniAuthError } from '../../src/errors/omni-auth-error.js';
import { createHostedServiceConfigFromEnv } from '../../src/hosted/create-hosted-auth-config.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  restoreEnv();
});

describe('createHostedServiceConfigFromEnv', () => {
  it('应该在最小环境变量下生成可运行的托管配置', () => {
    assignEnv({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/omni_login_kit',
      AUTH_JWT_SECRET: 'test-secret',
    });

    const hostedConfig = createHostedServiceConfigFromEnv();
    const passwordProvider = hostedConfig.authConfig.providers.find((provider) => provider.type === 'password');
    const emailCodeProvider = hostedConfig.authConfig.providers.find((provider) => provider.type === 'email_code');

    assert.equal(hostedConfig.runtime.host, '0.0.0.0');
    assert.equal(hostedConfig.runtime.port, 3000);
    assert.equal(hostedConfig.authConfig.baseUrl, 'http://localhost:3000');
    assert.deepEqual(hostedConfig.authConfig.security?.trustedRedirectHosts, ['localhost:3000']);
    assert.equal(passwordProvider?.enabled, true);
    assert.equal(emailCodeProvider?.enabled, false);
    assert.equal(hostedConfig.authConfig.senders, undefined);
  });

  it('应该按环境变量启用邮件、短信和 OAuth 配置', () => {
    assignEnv({
      PORT: '4010',
      DATABASE_URL: 'postgres://postgres:postgres@db:5432/omni_login_kit',
      AUTH_JWT_SECRET: 'test-secret',
      AUTH_BASE_URL: 'https://auth.example.com',
      AUTH_TRUSTED_REDIRECT_HOSTS: 'app.example.com,admin.example.com',
      AUTH_EMAIL_CODE_ENABLED: 'true',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '2525',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'mailer-password',
      SMTP_FROM: 'mailer@example.com',
      AUTH_SMS_ENABLED: 'true',
      AUTH_SMS_SENDER: 'aliyun-sms',
      ALIYUN_SMS_KEY: 'aliyun-key',
      ALIYUN_SMS_SECRET: 'aliyun-secret',
      ALIYUN_SMS_SIGN: 'aliyun-sign',
      ALIYUN_SMS_TEMPLATE: 'SMS_001',
      AUTH_FEISHU_ENABLED: 'true',
      FEISHU_CLIENT_ID: 'feishu-id',
      FEISHU_CLIENT_SECRET: 'feishu-secret',
    });

    const hostedConfig = createHostedServiceConfigFromEnv();
    const smsProvider = hostedConfig.authConfig.providers.find((provider) => provider.type === 'sms');
    const feishuProvider = hostedConfig.authConfig.providers.find((provider) => provider.type === 'feishu');

    assert.equal(hostedConfig.runtime.port, 4010);
    assert.deepEqual(hostedConfig.authConfig.security?.trustedRedirectHosts, [
      'auth.example.com',
      'app.example.com',
      'admin.example.com',
    ]);
    assert.equal(smsProvider?.enabled, true);
    assert.equal(smsProvider?.sender, 'aliyun-sms');
    assert.equal(feishuProvider?.enabled, true);
    assert.equal(feishuProvider?.clientId, 'feishu-id');
    assert.equal(hostedConfig.authConfig.senders?.['smtp-default']?.type, 'smtp');
    assert.equal(hostedConfig.authConfig.senders?.['aliyun-sms']?.type, 'aliyun_sms');
  });

  it('应该在布尔环境变量非法时抛出错误', () => {
    assignEnv({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/omni_login_kit',
      AUTH_JWT_SECRET: 'test-secret',
      AUTH_PASSWORD_ENABLED: 'maybe',
    });

    assert.throws(
      () => createHostedServiceConfigFromEnv(),
      (error: unknown) => {
        assert.equal(error instanceof OmniAuthError, true);
        assert.equal((error as OmniAuthError).code, 'AUTH_INPUT_001');
        return true;
      },
    );
  });
});

function assignEnv(overrides: Record<string, string>): void {
  restoreEnv();
  Object.assign(process.env, overrides);
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
}
