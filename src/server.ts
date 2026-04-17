import { createServer, type Server } from 'node:http';
import { createHostedAppFromEnv } from './hosted/create-hosted-app.js';

void main().catch((error) => {
  console.error('[omni-login-kit] failed to start hosted auth server');
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const runtime = await createHostedAppFromEnv();
  const server = createServer(runtime.app);
  await listen(server, runtime.runtime.host, runtime.runtime.port);

  console.log(
    `[omni-login-kit] hosted auth server listening on http://${runtime.runtime.host}:${runtime.runtime.port}${runtime.config.routePrefix}`,
  );

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (signal?: string): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        if (signal) {
          console.log(`[omni-login-kit] received ${signal}, shutting down`);
        }

        await closeServer(server);
        await runtime.shutdown();
      })();
    }

    return shutdownPromise;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => {
          process.exit(0);
        })
        .catch((error) => {
          console.error('[omni-login-kit] shutdown failed');
          console.error(error);
          process.exit(1);
        });
    });
  }
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('error', handleError);
      reject(error);
    };

    server.once('error', handleError);
    server.listen(port, host, () => {
      server.off('error', handleError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
