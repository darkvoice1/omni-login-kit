import { defineAuthConfig } from './src/index.js';

export default defineAuthConfig({
  appName: 'Demo App', // 需要改：你的应用名
  baseUrl: 'http://localhost:3000', // 需要改：你的服务地址
  routePrefix: '/auth', // 可先保持默认
  database: {
    provider: 'postgres',
    url: process.env.DATABASE_URL ?? '', // 直接读取环境变量
  },
  session: {
    strategy: 'jwt',
    accessTokenTtl: '15m', // 可先保持默认
    refreshTokenTtl: '30d', // 可先保持默认
    issuer: 'omni-login-kit', // 可先保持默认
    audience: 'demo-app', // 建议改：你的系统标识
    secret: process.env.AUTH_JWT_SECRET ?? '', // 直接读取环境变量
  },
  security: {
    trustedRedirectHosts: ['localhost:3000'], // 需要按你的域名调整
    enableAuditLog: true,
  },
  // 注意：至少启用 1 个 provider（enabled: true），否则启动会报错
  providers: [
    {
      type: 'password',
      enabled: false, // 默认关闭，按需改成 true
      allowUsername: true,
      allowEmail: true,
      allowPhone: true,
    },
    {
      type: 'email_code',
      enabled: false, // 需要邮箱验证码再开启
      sender: 'smtp-default',
      codeLength: 6,
      expiresInSeconds: 300,
    },
    {
      type: 'email_magic_link',
      enabled: false,
      sender: 'smtp-default',
      expiresInSeconds: 900,
    },
    {
      type: 'sms',
      enabled: false, // 需要短信再开启
      sender: 'tencent-sms', // 可选：aliyun-sms 或 tencent-sms
      codeLength: 6,
      expiresInSeconds: 300,
    },
    {
      type: 'wechat',
      enabled: false, // 需要微信登录再开启
      clientId: process.env.WECHAT_CLIENT_ID ?? '',
      clientSecret: process.env.WECHAT_CLIENT_SECRET ?? '',
      scope: ['snsapi_login'],
    },
    {
      type: 'wecom',
      enabled: false,
      clientId: process.env.WECOM_CLIENT_ID ?? '',
      clientSecret: process.env.WECOM_CLIENT_SECRET ?? '',
      scope: ['snsapi_login'],
    },
    {
      type: 'feishu',
      enabled: false,
      clientId: process.env.FEISHU_CLIENT_ID ?? '',
      clientSecret: process.env.FEISHU_CLIENT_SECRET ?? '',
      scope: ['contact:user.base:readonly'],
    },
  ],
  senders: {
    // 可选：保留完整模板也可以；不用的 sender 也可以删除
    'smtp-default': {
      type: 'smtp',
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
      from: process.env.SMTP_FROM ?? '',
    },
    'aliyun-sms': {
      type: 'aliyun_sms',
      accessKeyId: process.env.ALIYUN_SMS_KEY ?? '',
      accessKeySecret: process.env.ALIYUN_SMS_SECRET ?? '',
      signName: process.env.ALIYUN_SMS_SIGN ?? '',
      templateCode: process.env.ALIYUN_SMS_TEMPLATE ?? '',
    },
    'tencent-sms': {
      type: 'tencent_sms',
      secretId: process.env.TENCENT_SMS_SECRET_ID ?? '',
      secretKey: process.env.TENCENT_SMS_SECRET_KEY ?? '',
      smsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID ?? '',
      signName: process.env.TENCENT_SMS_SIGN_NAME ?? '',
      templateId: process.env.TENCENT_SMS_TEMPLATE_ID ?? '',
      region: process.env.TENCENT_SMS_REGION ?? 'ap-guangzhou',
    },
  },
});
