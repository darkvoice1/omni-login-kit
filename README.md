# omni-login-kit

一个面向 Node.js 的统一认证插件，用尽量少的接入代码支持多种登录方式。

## 功能特性

- 密码登录、注册、重置密码
- 邮箱验证码登录
- 邮箱魔法链接登录
- 短信验证码登录（阿里云 / 腾讯云）
- OAuth 登录（企业微信 / 飞书 / 微信）
- 登录后身份绑定与解绑

## 安装

```bash
npm i omni-login-kit
```

> 要求：Node.js `>= 22`，当今版本数据库只支持 PostgreSQL，后续会添加MySQL。

## 快速开始（Express）

### 1) 配置环境变量

先看规则：

- 必填（不填会启动失败）：`DATABASE_URL`、`AUTH_JWT_SECRET`
- 选填：按你启用的登录方式填写，不启用就留空

```env
# =========================
# 必填：基础配置（所有项目都要填）
# =========================

# 你的 PostgreSQL 连接串（不要照抄示例）
# 格式：postgres://<user>:<password>@<host>:<port>/<database>
DATABASE_URL=postgres://postgres:123456@localhost:5432/your_app_db

# JWT 密钥，至少 32 位随机字符串（不要用示例值）
AUTH_JWT_SECRET=replace-with-a-long-random-secret


# =========================
# 选填：邮箱登录能力（启用 email_code / email_magic_link 时填写）
# =========================
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USER=your_email@qq.com
SMTP_PASSWORD=your_smtp_auth_code
SMTP_FROM=your_email@qq.com


# =========================
# 选填：短信登录能力（启用 sms 时，二选一）
# =========================

# 阿里云短信
ALIYUN_SMS_KEY=
ALIYUN_SMS_SECRET=
ALIYUN_SMS_SIGN=
ALIYUN_SMS_TEMPLATE=

# 腾讯云短信
TENCENT_SMS_SECRET_ID=
TENCENT_SMS_SECRET_KEY=
TENCENT_SMS_SDK_APP_ID=
TENCENT_SMS_SIGN_NAME=
TENCENT_SMS_TEMPLATE_ID=
TENCENT_SMS_REGION=ap-guangzhou


# =========================
# 选填：OAuth 登录能力（按需填写）
# =========================

# 微信开放平台
WECHAT_CLIENT_ID=
WECHAT_CLIENT_SECRET=

# 企业微信
WECOM_CLIENT_ID=
WECOM_CLIENT_SECRET=

# 飞书
FEISHU_CLIENT_ID=
FEISHU_CLIENT_SECRET=
```

### 2) 创建 `auth.config.ts`放在根目录

下面这个示例可以直接复制，按注释修改即可：

```ts
import { defineAuthConfig } from 'omni-login-kit';

export default defineAuthConfig({
  appName: 'Your App', // 需要改：你的应用名
  baseUrl: 'http://localhost:3000', // 需要改：你的后端服务地址
  routePrefix: '/auth', // 可先不改：认证路由前缀
  database: {
    provider: 'postgres',
    url: process.env.DATABASE_URL ?? '', // 直接用环境变量
  },
  session: {
    strategy: 'jwt',
    accessTokenTtl: '15m',
    refreshTokenTtl: '30d',
    issuer: 'omni-login-kit',
    audience: 'your-app', // 建议改：你的系统标识
    secret: process.env.AUTH_JWT_SECRET ?? '', // 直接用环境变量
  },

  // 注意：至少启用 1 个 provider（enabled: true），否则启动会报错
  providers: [
    {
      type: 'password',
      enabled: false,
      allowUsername: true,
      allowEmail: true,
      allowPhone: true,
    },
    {
      type: 'email_code',
      enabled: false,
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
      sender: 'tencent-sms', // 可选：'aliyun-sms' 或 'tencent-sms'
      codeLength: 6,
      expiresInSeconds: 300,
    },
    {
      type: 'wechat',
      enabled: false,
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
```

### 3) 初始化数据库

数据库迁移只支持自动方式：在服务启动时调用 `await auth.initialize()` 后，插件会自动检查并执行 `migrations/*.sql`。

> 不需要用户在终端手动执行迁移命令。

### 4) 在你的后端入口文件中初始化（例如 `src/server.ts` 或 `src/app.ts`）

把下面代码写进你的项目启动文件：

```ts
import express from 'express';
import { OmniAuth, createAuthRouter, PostgresStorageAdapter } from 'omni-login-kit';
import authConfig from './auth.config.js';

const app = express();
app.use(express.json());

const auth = new OmniAuth({
  config: authConfig,
  storage: new PostgresStorageAdapter(authConfig.database.url),
});

// 自动迁移就在这一步触发
await auth.initialize();

app.use(authConfig.routePrefix, createAuthRouter(auth));

// 端口号请按你的项目实际情况修改（例如 3000 / 8080）
// 也可以改成读取环境变量，例如 const port = Number(process.env.PORT ?? 3000)
app.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});
```

> 重点：`new PostgresStorageAdapter(...)` 和 `await auth.initialize()` 要写在启动文件里，而不是命令行里。

## 常用接口

- `GET /auth/health`：健康检查
- `GET /auth/providers`：查看已启用登录方式
- `POST /auth/register/password`：密码注册
- `POST /auth/login/password`：密码登录
- `POST /auth/email-code/request` + `POST /auth/login/email_code`：邮箱验证码登录
- `POST /auth/sms/request` + `POST /auth/login/sms`：短信验证码登录
- `GET /auth/oauth/:providerType/authorize`：发起 OAuth 登录
- `GET /auth/oauth/:providerType/callback`：OAuth 回调
- `GET /auth/identities`：当前用户身份列表（Bearer Token）
- `DELETE /auth/identities/:identityId`：解绑身份（Bearer Token）

## 兼容性说明

- 当前内置数据库适配器：PostgreSQL
- 当前内置 HTTP 适配器：Express
- Koa / Fastify / Nest 以及 MySQL 可通过扩展适配器支持

## 本地开发

```bash
npm run build
npm test
```
