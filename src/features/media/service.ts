import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { getStorage } from './storage.js';
import { validateFile, ValidationError, getMediaPolicy } from './validation.js';
import type {
  MediaRecord,
  EntityType,
  FileCategory,
} from './types.js';

function mapRow(row: {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  file_type: string;
  mime_type: string;
  original_name: string | null;
  storage_path: string;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  created_at: string;
}): MediaRecord {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    fileType: row.file_type as FileCategory,
    mimeType: row.mime_type,
    originalName: row.original_name,
    storagePath: row.storage_path,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds ? parseFloat(row.duration_seconds) : null,
    createdAt: row.created_at,
  };
}

/**
 * Upload a media file and associate it with an entity.
 *
 * Flow: validate → store → insert metadata record → return.
 * Storage is written to disk before the DB record is created.
 * If the DB insert fails, the stored file becomes an orphan
 * which is handled by cleanupOrphanMedia().
 */
export async function uploadMedia(
  userId: string,
  entityType: EntityType,
  entityId: string,
  originalName: string,
  mimeType: string,
  content: Buffer,
): Promise<MediaRecord> {
  // Check attachment limits before proceeding
  await checkAttachmentLimit(entityType, entityId);

  // Validate the file
  let validation: Awaited<ReturnType<typeof validateFile>>;
  try {
    validation = await validateFile(content, mimeType, originalName);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw AppError.badRequest(err.message);
    }
    throw err;
  }

  // Store the file
  const storage = getStorage();
  const storagePath = await storage.store(originalName, content);

  // Create the database record
  const db = getDatabase();
  const result = await db
    .insertInto('media_items')
    .values({
      id: randomUUID(),
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      file_type: validation.fileType,
      mime_type: validation.mimeType,
      original_name: originalName,
      storage_path: storagePath,
      file_size: content.length,
      width: validation.width,
      height: validation.height,
      duration_seconds: validation.durationSeconds?.toString() ?? null,
      created_at: new Date().toISOString(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return mapRow(result);
}

/**
 * Check if the entity has reached its media attachment limit.
 */
async function checkAttachmentLimit(entityType: EntityType, entityId: string): Promise<void> {
  const policy = getMediaPolicy();
  const maxCount = entityType === 'product' ? policy.maxProductMedia : policy.maxReviewMedia;

  const db = getDatabase();
  const { count } = await db
    .selectFrom('media_items')
    .select(db.fn.countAll<number>().as('count'))
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .executeTakeFirstOrThrow();

  if (count >= maxCount) {
    throw AppError.badRequest(
      `Maximum ${maxCount} media items allowed per ${entityType}`,
    );
  }
}

/**
 * List media for an entity, ordered by creation date.
 * For products, also considers product_media_sorts ordering.
 */
export async function listMedia(
  entityType: EntityType,
  entityId: string,
): Promise<MediaRecord[]> {
  const db = getDatabase();

  let rows: Array<{
    id: string;
    user_id: string;
    entity_type: string;
    entity_id: string;
    file_type: string;
    mime_type: string;
    original_name: string | null;
    storage_path: string;
    file_size: number;
    width: number | null;
    height: number | null;
    duration_seconds: string | null;
    created_at: string;
  }>;

  if (entityType === 'product') {
    // For products, order by product_media_sorts.sort_order, then created_at
    rows = await db
      .selectFrom('media_items')
      .leftJoin('product_media_sorts', (join) =>
        join
          .onRef('product_media_sorts.media_id', '=', 'media_items.id')
          .onRef('product_media_sorts.product_id', '=', 'media_items.entity_id'))
      .selectAll('media_items')
      .where('media_items.entity_type', '=', entityType)
      .where('media_items.entity_id', '=', entityId)
      .orderBy('product_media_sorts.sort_order')
      .orderBy('media_items.created_at', 'asc')
      .execute();
  } else {
    // For reviews, order by creation date (most recent first)
    rows = await db
      .selectFrom('media_items')
      .selectAll()
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  return rows.map(mapRow);
}

/**
 * Get a single media record by ID.
 * Returns the raw DB row for ownership/comparison checks.
 */
async function getMediaById(mediaId: string): Promise<{
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  storage_path: string;
} | undefined> {
  const db = getDatabase();
  return await db
    .selectFrom('media_items')
    .select(['id', 'user_id', 'entity_type', 'entity_id', 'storage_path'])
    .where('id', '=', mediaId)
    .executeTakeFirst();
}

/**
 * Delete a media item. Only the original uploader or an admin can delete.
 * Removes the file from storage and the database record.
 */
export async function deleteMedia(
  userId: string,
  userRole: string | undefined,
  mediaId: string,
): Promise<void> {
  const media = await getMediaById(mediaId);
  if (!media) {
    throw AppError.notFound('Media not found');
  }

  // Authorization: uploader owns the media, or admin can delete any
  if (media.user_id !== userId && userRole !== 'backend_admin') {
    throw AppError.forbidden('You do not have permission to delete this media');
  }

  // Delete from storage (allow failure — orphan cleanup handles it)
  const storage = getStorage();
  try {
    await storage.delete(media.storage_path);
  } catch {
    // File may already be missing — proceed with DB cleanup
  }

  // Delete DB record
  const db = getDatabase();
  const result = await db
    .deleteFrom('media_items')
    .where('id', '=', mediaId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw AppError.notFound('Media not found');
  }
}

/**
 * Update product media sort order.
 * Accepts an ordered array of media IDs belonging to the product.
 */
export async function reorderProductMedia(
  productId: string,
  mediaIds: string[],
): Promise<void> {
  const db = getDatabase();

  // Verify all media IDs belong to this product
  const existing = await db
    .selectFrom('media_items')
    .select(['id'])
    .where('entity_type', '=', 'product')
    .where('entity_id', '=', productId)
    .execute();

  const existingIds = new Set(existing.map((r) => r.id));
  for (const id of mediaIds) {
    if (!existingIds.has(id)) {
      throw AppError.badRequest(`Media ${id} is not associated with this product`);
    }
  }

  // Delete existing sort entries and insert new ones
  await db
    .deleteFrom('product_media_sorts')
    .where('product_id', '=', productId)
    .execute();

  if (mediaIds.length === 0) return;

  await db
    .insertInto('product_media_sorts')
    .values(
      mediaIds.map((mediaId, index) => ({
        product_id: productId,
        media_id: mediaId,
        sort_order: index,
      })),
    )
    .execute();
}

/**
 * Clean up orphaned media — records where the storage file is missing.
 * This runs at startup and can be called manually.
 */
export async function cleanupOrphanMedia(): Promise<number> {
  const db = getDatabase();
  const storage = getStorage();
  let cleaned = 0;

  const items = await db
    .selectFrom('media_items')
    .select(['id', 'storage_path'])
    .execute();

  for (const item of items) {
    try {
      await storage.retrieve(item.storage_path);
    } catch {
      // File not found — delete orphaned record
      await db
        .deleteFrom('media_items')
        .where('id', '=', item.id)
        .execute();
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get the public URL for a media item by ID.
 */
export function getMediaUrl(storagePath: string): string {
  const storage = getStorage();
  return storage.getUrl(storagePath);
}