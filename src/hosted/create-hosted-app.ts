import express, { type Express } from 'express';
import { createAuthRouter } from '../adapters/express/create-auth-router.js';
import { OmniAuth } from '../core/omni-auth.js';
import { PostgresStorageAdapter } from '../storage/postgres/postgres-storage-adapter.js';
import type { OmniAuthConfig } from '../types/auth-config.js';
import { createHostedServiceConfigFromEnv } from './create-hosted-auth-config.js';

export interface HostedAppRuntime {
  app: Express;
  auth: OmniAuth;
  config: OmniAuthConfig;
  runtime: {
    host: string;
    port: number;
    trustProxy: boolean;
  };
  shutdown: () => Promise<void>;
}

/**
 * 创建官方托管模式的 HTTP 服务。
 */
export async function createHostedAppFromEnv(): Promise<HostedAppRuntime> {
  const hostedConfig = createHostedServiceConfigFromEnv();
  const storage = new PostgresStorageAdapter(hostedConfig.authConfig.database.url);
  const auth = new OmniAuth({
    config: hostedConfig.authConfig,
    storage,
  });

  await auth.initialize();

  const app = express();
  app.set('trust proxy', hostedConfig.runtime.trustProxy);
  app.use(express.json());
  app.get('/', (_request, response) => {
    response.json({
      ok: true,
      appName: hostedConfig.authConfig.appName,
      routePrefix: hostedConfig.authConfig.routePrefix,
    });
  });
  app.use(hostedConfig.authConfig.routePrefix, createAuthRouter(auth));

  return {
    app,
    auth,
    config: hostedConfig.authConfig,
    runtime: hostedConfig.runtime,
    shutdown: async () => {
      await auth.shutdown();
    },
  };
}
