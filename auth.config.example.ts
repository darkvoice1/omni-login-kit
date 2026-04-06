import { defineAuthConfig } from './src/index.js';

export default defineAuthConfig({
  appName: 'Demo App',
  baseUrl: 'http://localhost:3000',
  routePrefix: '/auth',
  database: {
    provider: 'postgres',
    url: process.env.DATABASE_URL ?? '',
  },
  session: {
    strategy: 'jwt',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    issuer: 'omni-login-kit',
    audience: 'demo-app',
    secret: process.env.AUTH_JWT_SECRET ?? '',
  },
  ui: {
    mode: 'hosted',
    loginPath: '/login',
    theme: {
      primaryColor: '#1f5eff',
    },
  },
  security: {
    trustedRedirectHosts: ['localhost:3000'],
    enableAuditLog: true,
  },
  providers: [
    {
      type: 'password',
      enabled: true,
      allowUsername: true,
      allowEmail: true,
      allowPhone: true,
    },
    {
      type: 'email_code',
      enabled: true,
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
      enabled: false,
      sender: 'aliyun-sms',
      codeLength: 6,
      expiresInSeconds: 300,
    },
    {
      type: 'github',
      enabled: false,
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      scope: ['read:user', 'user:email'],
    },
    {
      type: 'google',
      enabled: false,
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      scope: ['openid', 'email', 'profile'],
    },
    {
      type: 'wechat',
      enabled: false,
      clientId: process.env.WECHAT_CLIENT_ID ?? '',
      clientSecret: process.env.WECHAT_CLIENT_SECRET ?? '',
      scope: ['snsapi_login'],
    },
  ],
  senders: {
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
  },
});
