import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { createPool, destroyPool } from './db/pool.js';
import { createDatabase, destroyDatabase } from './db/database.js';

function main(): void {
  const pool = createPool();
  createDatabase(pool);

  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        port: env.PORT,
        host: env.HOST,
        nodeEnv: env.NODE_ENV,
        apiVersion: env.API_VERSION,
      },
      'Server started',
    );
  });

  function shutdown(signal: string): void {
    logger.info({ signal }, 'Shutdown signal received');

    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Error during server close');
        process.exit(1);
        return;
      }

      logger.info('Server closed');

      destroyDatabase()
        .then(() => destroyPool())
        .then(() => {
          process.exit(0);
        })
        .catch((dbErr) => {
          logger.error({ err: dbErr }, 'Error during database shutdown');
          process.exit(1);
        });
    });

    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);

    forceExit.unref();
  }

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main();