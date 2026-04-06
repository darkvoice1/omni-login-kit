# `auth.config.ts` 配置草案

## 1. 设计目标

- 一个文件描述认证系统的主要行为
- 敏感配置通过 `.env` 注入
- Provider 开关统一放在配置里
- 尽量减少用户手写样板代码

## 2. 建议配置方式

```ts
import { defineAuthConfig } from './src/config';

export default defineAuthConfig({
  appName: 'Demo App',
  baseUrl: 'http://localhost:3000',
  routePrefix: '/auth',
  database: {
    provider: 'postgres',
    url: process.env.DATABASE_URL!,
  },
  session: {
    strategy: 'jwt',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    issuer: 'omni-login-kit',
    audience: 'demo-app',
    secret: process.env.AUTH_JWT_SECRET!,
  },
  ui: {
    mode: 'hosted',
    loginPath: '/login',
    theme: {
      logoUrl: '/assets/logo.svg',
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
      enabled: true,
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
      enabled: true,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scope: ['read:user', 'user:email'],
    },
    {
      type: 'google',
      enabled: true,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scope: ['openid', 'email', 'profile'],
    },
    {
      type: 'wechat',
      enabled: false,
      clientId: process.env.WECHAT_CLIENT_ID!,
      clientSecret: process.env.WECHAT_CLIENT_SECRET!,
      scope: ['snsapi_login'],
    },
  ],
  senders: {
    'smtp-default': {
      type: 'smtp',
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER!,
      password: process.env.SMTP_PASSWORD!,
      from: process.env.SMTP_FROM!,
    },
    'aliyun-sms': {
      type: 'aliyun_sms',
      accessKeyId: process.env.ALIYUN_SMS_KEY!,
      accessKeySecret: process.env.ALIYUN_SMS_SECRET!,
      signName: process.env.ALIYUN_SMS_SIGN!,
      templateCode: process.env.ALIYUN_SMS_TEMPLATE!,
    },
  },
});
```

## 3. 顶层字段说明

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `appName` | 是 | 应用名称，用于日志、邮件文案等 |
| `baseUrl` | 是 | 当前应用对外访问地址 |
| `routePrefix` | 是 | 认证路由前缀，默认建议 `/auth` |
| `database` | 是 | 数据库类型和连接信息 |
| `session` | 是 | 登录态策略和 JWT 配置 |
| `ui` | 否 | 默认登录页模式和主题配置 |
| `security` | 否 | 安全相关基础设置 |
| `providers` | 是 | 启用的登录方式列表 |
| `senders` | 否 | 邮件和短信发送通道配置 |

## 4. Provider 配置原则

- 所有 Provider 都必须包含 `type` 和 `enabled`
- 不同 Provider 使用各自的附加字段
- 登录方式启用后，默认 UI 会自动显示入口
- 配置校验失败时，在启动阶段直接报错

## 5. 首版支持的 Provider 类型

| 类型 | 用途 |
| --- | --- |
| `password` | 用户名/邮箱/手机号 + 密码 |
| `email_code` | 邮箱验证码登录 |
| `email_magic_link` | 邮箱魔法链接登录 |
| `sms` | 手机验证码登录 |
| `github` | GitHub OAuth 登录 |
| `google` | Google OAuth 登录 |
| `wechat` | 微信 OAuth 登录 |

## 6. 环境变量建议

```env
DATABASE_URL=
AUTH_JWT_SECRET=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

ALIYUN_SMS_KEY=
ALIYUN_SMS_SECRET=
ALIYUN_SMS_SIGN=
ALIYUN_SMS_TEMPLATE=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

WECHAT_CLIENT_ID=
WECHAT_CLIENT_SECRET=
```

## 7. 启动阶段校验规则

- `baseUrl` 必须是合法 URL
- `routePrefix` 必须以 `/` 开头
- 至少启用一个 Provider
- `session.secret` 不允许为空
- 所有启用的 OAuth Provider 必须提供 `clientId` 和 `clientSecret`
- 所有启用的验证码类 Provider 必须能找到对应 `sender`
- `senders` 中每个发送器的必填字段必须完整

## 8. 后续演进方向

- 增加 `callbacks` 配置钩子
- 增加 `events` 事件订阅
- 增加 `features` 开关项
- 增加 `pages` 自定义页面映射
