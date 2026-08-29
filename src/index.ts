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
 * and no existing user with all 4 backend roles is found.
 *
 * The bootstrap administrator receives ALL backend roles:
 * - backend_read
 * - backend_write
 * - backend_admin
 * - user_management
 *
 * Uses bcrypt password hashing (same as registration).
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

  // Check if any user already has the user_management role (indicates an admin exists)
  const existingAdmin = await db
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .select('user_roles.user_id')
    .where('roles.name', '=', 'user_management')
    .executeTakeFirst();

  if (existingAdmin) {
    logger.info('Admin user already exists — skipping bootstrap');
    return;
  }

  // Fetch all role IDs
  const allRoles = await db
    .selectFrom('roles')
    .select(['id', 'name'])
    .execute();

  const roleIds = allRoles.map((r) => r.id);

  // Check if user with bootstrap email already exists
  const existingUser = await db
    .selectFrom('users')
    .select(['id'])
    .where('email', '=', email)
    .executeTakeFirst();

  if (existingUser) {
    // Assign all backend roles
    for (const roleId of roleIds) {
      await sql`
        INSERT INTO user_roles (user_id, role_id, created_at)
        VALUES (${existingUser.id}, ${roleId}, now())
        ON CONFLICT DO NOTHING
      `.execute(db);
    }
    logger.info({ email }, 'Assigned all backend roles to existing user');
    return;
  }

  // Create new admin user with all roles
  const passwordHash = await hashPassword(password);
  const userResult = await sql<{ id: string }>`
    INSERT INTO users (email, password_hash, created_at, updated_at)
    VALUES (${email}, ${passwordHash}, now(), now())
    RETURNING id
  `.execute(db);

  const userId = userResult.rows[0]!.id;

  // Assign all backend roles
  for (const roleId of roleIds) {
    await sql`
      INSERT INTO user_roles (user_id, role_id, created_at)
      VALUES (${userId}, ${roleId}, now())
    `.execute(db);
  }

  logger.info({ email }, 'Admin user bootstrapped successfully with all backend roles');
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