import { env, validateProductionConfig } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { createPool, destroyPool } from './db/pool.js';
import { createDatabase, destroyDatabase, getDatabase } from './db/database.js';
import { sql } from 'kysely';
import { hashPassword } from './auth/password.js';
import http from 'node:http';

/**
 * Bootstrap an initial admin user from environment configuration.
 * Only runs when ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are set
 * and no existing admin user is found. Uses bcrypt password hashing (same as registration).
 * This is a development-friendly bootstrap — in production, create the first admin
 * through a migration, seed script, or admin creation endpoint instead.
 */
async function bootstrapAdmin(): Promise<void> {
  const email = env.ADMIN_BOOTSTRAP_EMAIL;
  const password = env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) {
    return; // Not configured — skip
  }

  const db = getDatabase();

  // Check if any admin user exists
  const existing = await db
    .selectFrom('users')
    .select(['id'])
    .where('role', '=', 'admin')
    .executeTakeFirst();

  if (existing) {
    logger.info('Admin user already exists — skipping bootstrap');
    return;
  }

  // Check if user with bootstrap email already exists (as non-admin)
  const existingUser = await db
    .selectFrom('users')
    .select(['id', 'role'])
    .where('email', '=', email)
    .executeTakeFirst();

  if (existingUser) {
    // Upgrade existing user to admin
    await db
      .updateTable('users')
      .set({ role: 'admin', updated_at: sql`now()` })
      .where('id', '=', existingUser.id)
      .execute();
    logger.info({ email }, 'Upgraded existing user to admin');
    return;
  }

  // Create new admin user
  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO users (email, password_hash, role, created_at, updated_at)
    VALUES (${email}, ${passwordHash}, 'admin', now(), now())
  `.execute(db);

  logger.info({ email }, 'Admin user bootstrapped successfully');
}

function main(): void {
  // Fail fast in production if unsafe default config would be used
  validateProductionConfig();

  const pool = createPool();
  createDatabase(pool);

  const app = createApp();

  let server: http.Server;

  // Bootstrap admin user from env configuration, then start server
  bootstrapAdmin()
    .then(() => {
      server = app.listen(env.PORT, env.HOST, () => {
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
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to bootstrap admin');
      process.exit(1);
    });
}

main();