/**
 * Media module types.
 *
 * Shared type definitions for the Media/File Upload module,
 * used by storage, validation, service, and route layers.
 */

export type FileCategory = 'image' | 'video';

export type EntityType = 'product' | 'review';

/**
 * Allowed media extensions and MIME types.
 * These are the canonical allowed lists — validation and storage
 * reference these rather than duplicating policies.
 */
export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
export type ImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number];

export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4'] as const;
export type VideoExtension = (typeof ALLOWED_VIDEO_EXTENSIONS)[number];

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4'] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type AllowedVideoMime = (typeof ALLOWED_VIDEO_MIME_TYPES)[number];

/**
 * Media metadata stored in the database and returned from the module.
 */
export interface MediaRecord {
  id: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  fileType: FileCategory;
  mimeType: string;
  originalName: string | null;
  storagePath: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  createdAt: string;
}

/**
 * Input for creating a new media record.
 */
export interface CreateMediaInput {
  userId: string;
  entityType: EntityType;
  entityId: string;
  fileType: FileCategory;
  mimeType: string;
  originalName: string | null;
  storagePath: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/**
 * Result of validating a file.
 */
export interface ValidationResult {
  valid: true;
  fileType: FileCategory;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface ValidationError {
  valid: false;
  error: string;
}

/**
 * Media policy limits — loaded from env config.
 */
export interface MediaPolicy {
  maxImageSizeBytes: number;
  maxVideoSizeBytes: number;
  maxVideoDurationSeconds: number;
  maxImageDimension: number;
  maxVideoDimension: number;
  maxProductMedia: number;
  maxReviewMedia: number;
}

/**
 * Storage abstraction interface.
 * Allows swapping the local filesystem for object storage
 * without changing business logic.
 */
export interface MediaStorage {
  /** Store a file buffer, return the storage path. */
  store(filename: string, content: Buffer): Promise<string>;
  /** Retrieve a file buffer by storage path. */
  retrieve(storagePath: string): Promise<Buffer>;
  /** Delete a file by storage path. */
  delete(storagePath: string): Promise<void>;
  /** Get the public URL for a storage path. */
  getUrl(storagePath: string): string;
}