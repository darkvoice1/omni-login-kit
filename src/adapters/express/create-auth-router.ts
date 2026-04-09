import { Router, type Request, type Response } from 'express';
import type { OmniAuth } from '../../core/omni-auth.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { ProviderType } from '../../types/auth-config.js';

export function createAuthRouter(auth: OmniAuth): Router {
  const router = Router();

  router.get('/health', (_request: Request, response: Response) => {
    response.json({
      ok: true,
      appName: auth.config.appName,
    });
  });

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
   * 请求邮箱验证码。
   */
  router.post('/email-code/request', async (request: Request, response: Response) => {
    try {
      const result = await auth.requestEmailCode(request.body ?? {});
      response.json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  /**
   * 请求短信验证码。
   */
  router.post('/sms/request', async (request: Request, response: Response) => {
    try {
      const result = await auth.requestSmsCode(request.body ?? {});
      response.json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  router.post('/register/password', async (request: Request, response: Response) => {
    try {
      const result = await auth.registerWithPassword(request.body ?? {});
      response.status(201).json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  router.post('/login/:providerType', async (request: Request, response: Response) => {
    try {
      const providerType = request.params.providerType as ProviderType;
      const result = await auth.authenticateWithCredentials(providerType, request.body ?? {}, {
        ipAddress: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
      });
      response.json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  router.post('/logout', async (request: Request, response: Response) => {
    try {
      const result = await auth.logout(request.body ?? {});
      response.json(result);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  router.get('/oauth/:providerType/authorize', async (request: Request, response: Response) => {
    try {
      const providerType = request.params.providerType as ProviderType;
      const url = await auth.createAuthorizationUrl(providerType, {
        redirectTo: request.query.redirectTo,
      });

      response.redirect(url);
    } catch (error) {
      handleHttpError(error, response);
    }
  });

  router.get('/oauth/:providerType/callback', async (request: Request, response: Response) => {
    try {
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
