import { Router, type Request, type Response } from 'express';
import type { OmniAuth } from '../../core/omni-auth.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { ProviderType } from '../../types/auth-config.js';

/**
 * 创建可挂载到 Express 的认证路由。
 */
export function createAuthRouter(auth: OmniAuth): Router {
  const router = Router();

  /**
   * 健康检查接口。
   */
  router.get('/health', (_request: Request, response: Response) => {
    response.json({
      ok: true,
      appName: auth.config.appName,
    });
  });

  /**
   * 返回当前已启用 Provider 列表。
   */
  router.get('/providers', (_request: Request, response: Response) => {
    response.json({
      providers: auth.listEnabledProviders().map((provider) => ({
        name: provider.name,
        type: provider.type,
        enabled: provider.enabled,
      })),
    });
  });

  /**
   * 处理账号类登录请求。
   */
  router.post('/login/:providerType', async (request: Request, response: Response) => {
    try {
      // 从路由参数中拿到 Provider 类型，并把请求体交给核心层。
      const providerType = request.params.providerType as ProviderType;
      const result = await auth.authenticateWithCredentials(providerType, request.body ?? {});
      response.json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  /**
   * 发起 OAuth 授权。
   */
  router.get('/oauth/:providerType/authorize', async (request: Request, response: Response) => {
    try {
      // 读取跳转地址等可选参数，并生成第三方授权链接。
      const providerType = request.params.providerType as ProviderType;
      const url = await auth.createAuthorizationUrl(providerType, {
        redirectTo: request.query.redirectTo,
      });

      response.redirect(url);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  /**
   * 处理 OAuth 回调。
   */
  router.get('/oauth/:providerType/callback', async (request: Request, response: Response) => {
    try {
      // 从查询参数中读取 code 和 state，并交给核心层统一处理。
      const providerType = request.params.providerType as ProviderType;
      const code = String(request.query.code ?? '');
      const state = String(request.query.state ?? '');
      const result = await auth.handleOAuthCallback(providerType, { code, state });
      response.json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  return router;
}

/**
 * 把内部错误转换为 HTTP 响应。
 */
function handleHttpError(error: unknown, response: Response): void {
  if (error instanceof OmniAuthError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误',
    },
  });
}
