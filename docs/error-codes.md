# 错误码规范

## 1. 设计目标

- 启动期、运行期、Provider 期错误统一编码
- 便于日志检索、接口返回和文档查阅
- 不把底层异常直接暴露给调用方

## 2. 编码规则

格式：

```text
<域>_<场景>_<编号>
```

例如：

- `CFG_BASEURL_001`
- `AUTH_CREDENTIALS_001`
- `OAUTH_STATE_002`

域建议：

- `CFG` 配置相关
- `AUTH` 通用认证流程
- `USER` 用户和身份
- `SESSION` 会话
- `VERIFY` 验证码和魔法链接
- `OAUTH` OAuth 流程
- `EMAIL` 邮件发送
- `SMS` 短信发送
- `PROVIDER` Provider 生命周期
- `DB` 存储层

## 3. 启动期错误

| 错误码 | 含义 |
| --- | --- |
| `CFG_BASEURL_001` | `baseUrl` 缺失或非法 |
| `CFG_ROUTEPREFIX_001` | `routePrefix` 非法 |
| `CFG_PROVIDER_001` | 没有启用任何 Provider |
| `CFG_SESSION_001` | Session 配置缺失 |
| `CFG_SECRET_001` | JWT 密钥缺失 |
| `CFG_DATABASE_001` | 数据库连接配置缺失 |
| `CFG_SENDER_001` | 已启用的验证码 Provider 未找到发送器 |
| `CFG_OAUTH_001` | OAuth Provider 缺少 `clientId` 或 `clientSecret` |

## 4. 通用认证错误

| 错误码 | 含义 |
| --- | --- |
| `AUTH_CREDENTIALS_001` | 账号或密码错误 |
| `AUTH_PROVIDER_001` | 未找到指定 Provider |
| `AUTH_PROVIDER_002` | Provider 未启用 |
| `AUTH_INPUT_001` | 登录输入参数不合法 |
| `AUTH_USER_001` | 用户不存在 |
| `AUTH_USER_002` | 用户已禁用 |
| `AUTH_BINDING_001` | 账号绑定冲突 |
| `AUTH_REDIRECT_001` | 跳转地址不可信 |

## 5. 用户和身份错误

| 错误码 | 含义 |
| --- | --- |
| `USER_IDENTITY_001` | 身份不存在 |
| `USER_IDENTITY_002` | 身份与用户不匹配 |
| `USER_EMAIL_001` | 邮箱已被其他用户占用 |
| `USER_PHONE_001` | 手机号已被其他用户占用 |

## 6. 验证码和魔法链接错误

| 错误码 | 含义 |
| --- | --- |
| `VERIFY_CODE_001` | 验证码错误 |
| `VERIFY_CODE_002` | 验证码已过期 |
| `VERIFY_CODE_003` | 验证码已使用 |
| `VERIFY_CODE_004` | 验证码尝试次数超限 |
| `VERIFY_RATE_001` | 发送频率过高 |
| `VERIFY_TOKEN_001` | 魔法链接无效 |
| `VERIFY_TOKEN_002` | 魔法链接已过期 |

## 7. OAuth 错误

| 错误码 | 含义 |
| --- | --- |
| `OAUTH_STATE_001` | 缺少 state |
| `OAUTH_STATE_002` | state 无效或已过期 |
| `OAUTH_CODE_001` | 授权码缺失 |
| `OAUTH_TOKEN_001` | 换取 access token 失败 |
| `OAUTH_PROFILE_001` | 获取第三方用户信息失败 |
| `OAUTH_BINDING_001` | 第三方账号绑定冲突 |

## 8. 会话错误

| 错误码 | 含义 |
| --- | --- |
| `SESSION_ACCESS_001` | Access Token 无效 |
| `SESSION_REFRESH_001` | Refresh Token 无效 |
| `SESSION_REFRESH_002` | Refresh Token 已过期 |
| `SESSION_REFRESH_003` | Refresh Token 已撤销 |

## 9. 发送器错误

| 错误码 | 含义 |
| --- | --- |
| `EMAIL_SEND_001` | 邮件发送失败 |
| `EMAIL_TEMPLATE_001` | 邮件模板不存在或渲染失败 |
| `SMS_SEND_001` | 短信发送失败 |
| `SMS_VENDOR_001` | 短信服务商响应异常 |

## 10. Provider 和存储层错误

| 错误码 | 含义 |
| --- | --- |
| `PROVIDER_INIT_001` | Provider 初始化失败 |
| `PROVIDER_RUNTIME_001` | Provider 执行失败 |
| `DB_QUERY_001` | 数据查询失败 |
| `DB_WRITE_001` | 数据写入失败 |
| `DB_TX_001` | 数据库事务失败 |

## 11. 接口返回建议

对外接口建议统一返回：

```json
{
  "error": {
    "code": "AUTH_CREDENTIALS_001",
    "message": "Invalid credentials"
  }
}
```

首版约束：

- 对外返回稳定错误码
- 对用户暴露简洁消息
- 详细异常只写日志，不直接透出内部堆栈
