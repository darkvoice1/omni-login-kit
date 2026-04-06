# 数据表设计草案

## 1. 设计目标

- 支撑多种登录方式归并到同一用户体系
- 支撑验证码、魔法链接、OAuth 登录和会话管理
- 支撑后续账号绑定、审计和风控能力扩展

首版推荐数据库：PostgreSQL。

## 2. 核心关系

```text
users 1 --- n identities
users 1 --- n sessions
users 1 --- n audit_logs
identities 1 --- 0..1 credentials
verification_tokens 0..n -> users
oauth_states 0..n -> identities
```

## 3. `users`

系统中的统一用户主体，不直接绑定某一种登录方式。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `display_name` | varchar(100) | 展示名称 |
| `avatar_url` | text | 头像 |
| `email` | varchar(255) nullable | 主邮箱 |
| `phone` | varchar(32) nullable | 主手机号 |
| `status` | varchar(32) | `active` / `disabled` / `pending` |
| `last_login_at` | timestamptz nullable | 最后登录时间 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

索引建议：

- 唯一索引：`email`，允许空值
- 唯一索引：`phone`，允许空值
- 普通索引：`status`

## 4. `identities`

每条记录代表一种登录身份，是“用户”和“登录方式”的连接层。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `user_id` | uuid | 关联 `users.id` |
| `provider_type` | varchar(64) | `password` / `email_code` / `github` 等 |
| `provider_subject` | varchar(255) | 第三方平台唯一标识，如 OAuth `sub` |
| `email` | varchar(255) nullable | 该身份关联邮箱 |
| `phone` | varchar(32) nullable | 该身份关联手机号 |
| `nickname` | varchar(100) nullable | 第三方昵称快照 |
| `avatar_url` | text nullable | 第三方头像快照 |
| `metadata` | jsonb | 扩展信息 |
| `last_used_at` | timestamptz nullable | 最近使用时间 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

索引建议：

- 唯一索引：`provider_type + provider_subject`
- 普通索引：`user_id`
- 普通索引：`email`
- 普通索引：`phone`

说明：

- 本地密码登录可以把账号本身也抽象成一种 `identity`
- OAuth 登录的 `provider_subject` 用第三方返回的唯一用户标识

## 5. `credentials`

本地凭证表，保存密码哈希等敏感信息。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `identity_id` | uuid | 关联 `identities.id` |
| `password_hash` | text | 密码哈希 |
| `password_algo` | varchar(32) | 哈希算法，如 `argon2id` |
| `password_updated_at` | timestamptz nullable | 密码更新时间 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

索引建议：

- 唯一索引：`identity_id`

## 6. `verification_tokens`

统一承载短信验证码、邮箱验证码和魔法链接令牌。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `scene` | varchar(64) | `login` / `bind` / `reset_password` |
| `channel` | varchar(32) | `email` / `sms` / `magic_link` |
| `target` | varchar(255) | 邮箱或手机号 |
| `token_hash` | text | 验证码或链接令牌的哈希 |
| `code_length` | int nullable | 验证码长度 |
| `attempt_count` | int | 已尝试次数 |
| `max_attempts` | int | 最大尝试次数 |
| `expires_at` | timestamptz | 过期时间 |
| `consumed_at` | timestamptz nullable | 使用时间 |
| `sender_name` | varchar(64) nullable | 发送器名称 |
| `metadata` | jsonb | 扩展信息 |
| `created_at` | timestamptz | 创建时间 |

索引建议：

- 普通索引：`target + scene + channel`
- 普通索引：`expires_at`
- 普通索引：`consumed_at`

## 7. `oauth_states`

OAuth 授权过程中的 `state` 存储，用于防 CSRF 和回调校验。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `provider_type` | varchar(64) | `github` / `google` / `wechat` |
| `state_hash` | text | state 哈希 |
| `redirect_to` | text nullable | 登录成功后的跳转地址 |
| `pkce_verifier` | text nullable | 后续若支持 PKCE 可复用 |
| `expires_at` | timestamptz | 过期时间 |
| `consumed_at` | timestamptz nullable | 使用时间 |
| `created_at` | timestamptz | 创建时间 |

索引建议：

- 普通索引：`provider_type`
- 普通索引：`expires_at`

## 8. `sessions`

保存刷新令牌对应的服务端会话记录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `user_id` | uuid | 关联 `users.id` |
| `refresh_token_hash` | text | 刷新令牌哈希 |
| `device_info` | jsonb nullable | 设备信息 |
| `ip_address` | inet nullable | 登录 IP |
| `user_agent` | text nullable | 用户代理 |
| `expires_at` | timestamptz | 过期时间 |
| `revoked_at` | timestamptz nullable | 注销时间 |
| `last_seen_at` | timestamptz nullable | 最近访问时间 |
| `created_at` | timestamptz | 创建时间 |

索引建议：

- 普通索引：`user_id`
- 普通索引：`expires_at`
- 普通索引：`revoked_at`

## 9. `audit_logs`

保存关键认证事件，便于问题排查和后续风控。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `user_id` | uuid nullable | 关联用户 |
| `event_type` | varchar(64) | 事件类型 |
| `provider_type` | varchar(64) nullable | 相关登录方式 |
| `target` | varchar(255) nullable | 邮箱或手机号等 |
| `ip_address` | inet nullable | 来源 IP |
| `user_agent` | text nullable | 用户代理 |
| `result` | varchar(32) | `success` / `failed` |
| `error_code` | varchar(64) nullable | 失败错误码 |
| `metadata` | jsonb | 扩展信息 |
| `created_at` | timestamptz | 创建时间 |

索引建议：

- 普通索引：`user_id`
- 普通索引：`event_type`
- 普通索引：`created_at`

## 10. 首版最小必备表

如果阶段二想先快速起步，最小闭环先建这 6 张表：

- `users`
- `identities`
- `credentials`
- `verification_tokens`
- `oauth_states`
- `sessions`

`audit_logs` 可以在阶段二末或阶段三初加入。

## 11. 设计取舍说明

- 不把所有登录方式拆成独立用户表，而是统一到 `users + identities`
- 不直接明文保存验证码、魔法链接和刷新令牌，统一保存哈希
- 不把 OAuth 回调状态全放客户端，首版落库更稳
- 不把密码字段混入 `identities`，单独拆到 `credentials` 便于安全管理
