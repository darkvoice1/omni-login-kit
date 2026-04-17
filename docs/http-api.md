# HTTP 接口文档

本文档用于说明 `omni-login-kit` 对外暴露的 HTTP 接口。

默认情况下：

- 服务基地址示例：`http://localhost:3000`
- 路由前缀示例：`/auth`
- 完整接口地址 = `服务基地址 + 路由前缀 + 具体路径`

## 接口目录

### 基础接口

- `GET /auth/health`
- `GET /auth/providers`

### 账号与会话接口

- `POST /auth/register/password`
- `POST /auth/login/password`
- `POST /auth/login/email_code`
- `POST /auth/login/email_magic_link`
- `POST /auth/login/sms`
- `POST /auth/logout`

### 验证码与魔法链接接口

- `POST /auth/email-code/request`
- `POST /auth/email-magic-link/request`
- `GET /auth/email-magic-link/callback`
- `POST /auth/sms/request`

### OAuth 接口

- `GET /auth/oauth/:providerType/authorize`
- `GET /auth/oauth/:providerType/callback`
- `GET /auth/oauth/:providerType/bind/authorize`
- `GET /auth/oauth/:providerType/bind/callback`

### 身份管理接口

- `GET /auth/identities`
- `DELETE /auth/identities/:identityId`

## 认证说明

- `GET /auth/identities`
- `DELETE /auth/identities/:identityId`
- `GET /auth/oauth/:providerType/bind/authorize`

以上接口需要在请求头中携带 Bearer Token：

```http
Authorization: Bearer <access_token>
```

## 说明

- `:providerType` 的可选值通常包括：`password`、`email_code`、`email_magic_link`、`sms`、`wechat`、`wecom`、`feishu`
- 实际可用的登录方式取决于你的配置，建议先调用 `GET /auth/providers` 查看当前启用项
- 错误码说明见 `docs/error-codes.md`

后续可以在本文档中继续补充每个接口的请求参数、响应示例和 `curl` 调用示例。