import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export type NotificationType = 'order_created' | 'payment_completed' | 'payment_failed';

function mapNotification(row: {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}): NotificationResponse {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * Create a notification within an existing transaction.
 * This is the primary way notifications are created — called from
 * within checkout, payment, and shipping transactions.
 */
export async function createNotification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trx: Kysely<any>,
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
): Promise<NotificationResponse> {
  const result = await sql<{
    id: string;
    type: string;
    title: string;
    message: string;
    is_read: boolean;
    read_at: string | null;
    created_at: string;
  }>`
    INSERT INTO notifications (user_id, type, title, message, created_at)
    VALUES (${userId}, ${type}, ${title}, ${message}, now())
    RETURNING *
  `.execute(trx);

  return mapNotification(result.rows[0]!);
}

/**
 * List notifications for the authenticated user, most recent first.
 * Supports optional pagination via limit and offset.
 */
export async function listNotifications(userId: string, limit = 50, offset = 0): Promise<NotificationResponse[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);

  const rows = await db
    .selectFrom('notifications')
    .select([
      'notifications.id',
      'notifications.type',
      'notifications.title',
      'notifications.message',
      'notifications.is_read',
      'notifications.read_at',
      'notifications.created_at',
    ])
    .where('notifications.user_id', '=', userId)
    .orderBy('notifications.created_at', 'desc')
    .limit(safeLimit)
    .offset(safeOffset)
    .execute();

  return rows.map(mapNotification);
}

/**
 * Mark a notification as read. Ownership-scoped.
 */
export async function markAsRead(userId: string, notificationId: string): Promise<NotificationResponse> {
  const db = getDatabase();

  const result = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('notifications')
      .select([
        'notifications.id',
        'notifications.is_read',
      ])
      .where('notifications.id', '=', notificationId)
      .where('notifications.user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();

    if (!existing) {
      throw AppError.notFound('Notification not found');
    }

    if (existing.is_read) {
      // Already read — just return current state
      const row = await trx
        .selectFrom('notifications')
        .select([
          'notifications.id',
          'notifications.type',
          'notifications.title',
          'notifications.message',
          'notifications.is_read',
          'notifications.read_at',
          'notifications.created_at',
        ])
        .where('notifications.id', '=', notificationId)
        .executeTakeFirstOrThrow();

      return mapNotification(row);
    }

    const updated = await sql<{
      id: string;
      type: string;
      title: string;
      message: string;
      is_read: boolean;
      read_at: string | null;
      created_at: string;
    }>`
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE id = ${notificationId}
      RETURNING *
    `.execute(trx);

    return mapNotification(updated.rows[0]!);
  });

  return result;
}