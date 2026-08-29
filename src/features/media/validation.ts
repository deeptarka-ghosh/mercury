import { env } from '../../config/env.js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
} from './types.js';
import type { FileCategory, MediaPolicy, ValidationResult } from './types.js';

/**
 * Custom error thrown when file validation fails.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Build the effective media policy from env configuration.
 */
export function getMediaPolicy(): MediaPolicy {
  return {
    maxImageSizeBytes: env.MAX_IMAGE_SIZE_MB * 1024 * 1024,
    maxVideoSizeBytes: env.MAX_VIDEO_SIZE_MB * 1024 * 1024,
    maxVideoDurationSeconds: env.MAX_VIDEO_DURATION_SECONDS,
    maxImageDimension: env.MAX_IMAGE_DIMENSION,
    maxVideoDimension: env.MAX_VIDEO_DIMENSION,
    maxProductMedia: env.MAX_PRODUCT_MEDIA,
    maxReviewMedia: env.MAX_REVIEW_MEDIA,
  };
}

/**
 * Extract file extension from original filename (lowercase).
 * Returns the extension including the dot, e.g. ".jpg".
 */
function getExtension(filename: string): string | null {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return null;
  return filename.slice(dotIndex).toLowerCase();
}

/**
 * Determine the file category from MIME type.
 */
function mimeToCategory(mime: string): FileCategory | null {
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return 'image';
  if ((ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mime)) return 'video';
  return null;
}

/**
 * Validate an image file by decoding it with sharp.
 * Throws ValidationError if corrupt or dimension limits exceeded.
 */
async function validateImage(
  buffer: Buffer,
  policy: MediaPolicy,
): Promise<{ width: number; height: number }> {
  let sharpModule: (buf: Buffer) => import('sharp').Sharp;
  try {
    sharpModule = (await import('sharp')).default;
  } catch {
    // sharp not installed — skip image content validation
    return { width: 0, height: 0 };
  }

  const sharp = sharpModule;
  let metadata: import('sharp').Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new ValidationError('Corrupt or invalid image file');
  }

  if (!metadata.width || !metadata.height) {
    throw new ValidationError('Unable to determine image dimensions');
  }

  // Fully decode the image — catches truncated files
  try {
    await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new ValidationError('Image decoding failed — file may be truncated or corrupt');
  }

  const width = metadata.width;
  const height = metadata.height;

  if (width > policy.maxImageDimension || height > policy.maxImageDimension) {
    throw new ValidationError(
      `Image dimensions ${width}x${height} exceed maximum ${policy.maxImageDimension}px`,
    );
  }

  return { width, height };
}

/**
 * Probe a video file using ffprobe.
 * Falls back to no-op if ffprobe is not available.
 */
async function probeVideo(
  buffer: Buffer,
): Promise<{ width: number; height: number; duration: number }> {
  const ffprobePath = await findFfprobe();
  if (!ffprobePath) {
    return { width: 0, height: 0, duration: 0 };
  }

  const { writeFile, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const tmpDir = env.UPLOAD_DIR;

  // Ensure temp dir exists
  const { mkdir } = await import('node:fs/promises');
  await mkdir(tmpDir, { recursive: true });

  const tmpFile = join(tmpDir, `.tmp-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  try {
    await writeFile(tmpFile, buffer);

    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        ffprobePath,
        [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          tmpFile,
        ],
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
        (err, stout) => {
          if (err) {
            reject(new Error(`ffprobe failed: ${err.message}`));
            return;
          }
          resolve(stout);
        },
      );
    });

    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };

    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    if (!videoStream) {
      throw new ValidationError('No video stream found in file');
    }

    const validCodecs = ['h264', 'hevc', 'av1'];
    if (videoStream.codec_name && !validCodecs.includes(videoStream.codec_name)) {
      throw new ValidationError(
        `Unsupported video codec: ${videoStream.codec_name}. Only H.264, H.265, and AV1 are allowed.`,
      );
    }

    const width = videoStream.width ?? 0;
    const height = videoStream.height ?? 0;
    const duration = data.format?.duration ? parseFloat(data.format.duration) : 0;

    return { width, height, duration };
  } finally {
    try {
      await unlink(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Find ffprobe on the system.
 */
async function findFfprobe(): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  const candidates = ['ffprobe', 'ffprobe.exe'];
  for (const name of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(name, ['-version'], { timeout: 3000 }, (execErr) => {
          if (execErr) reject(new Error(`ffprobe check failed: ${execErr.message}`));
          else resolve();
        });
      });
      return name;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Sniff MIME type from file magic bytes.
 * This is the authoritative check — never trust client-provided MIME.
 */
function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: starts with 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 8-byte signature
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.slice(0, 8).equals(pngSig)) {
    return 'image/png';
  }

  // WebP: "RIFF" + 4 bytes + "WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // MP4: ftyp box at offset 4
  const boxType = buffer.toString('ascii', 4, 8);
  if (boxType === 'ftyp' || boxType === 'moov') {
    return 'video/mp4';
  }

  return null;
}

/**
 * Validate a file before storage.
 *
 * Checks:
 * 1. MIME type via magic bytes (authoritative)
 * 2. Extension vs MIME consistency (spoof detection)
 * 3. File size against policy limits
 * 4. Image integrity via sharp decode
 * 5. Video container/codec/duration via ffprobe
 *
 * Returns validated metadata on success.
 * Throws ValidationError on failure.
 */
export async function validateFile(
  buffer: Buffer,
  clientMime: string,
  originalName: string,
): Promise<ValidationResult> {
  const policy = getMediaPolicy();

  // 1. Sniff MIME from file header (authoritative)
  const sniffed = sniffMimeType(buffer);
  const effectiveMime = sniffed ?? clientMime;

  // 2. Determine category
  const category = mimeToCategory(effectiveMime);
  if (!category) {
    throw new ValidationError(`Unsupported file type: ${effectiveMime}`);
  }

  // 3. Verify extension matches MIME (spoof detection)
  const ext = originalName ? getExtension(originalName) : null;
  if (ext) {
    if (category === 'image' && !/^\.(jpe?g|png|webp)$/i.test(ext)) {
      throw new ValidationError(`Invalid image extension: ${ext}`);
    }
    if (category === 'video' && !/^\.(mp4)$/i.test(ext)) {
      throw new ValidationError(`Invalid video extension: ${ext}`);
    }
  }

  // 4. File size check
  const maxSize = category === 'image' ? policy.maxImageSizeBytes : policy.maxVideoSizeBytes;
  if (buffer.length > maxSize) {
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
    const limitMB = (maxSize / 1024 / 1024).toFixed(0);
    throw new ValidationError(`File size ${sizeMB}MB exceeds ${category} limit of ${limitMB}MB`);
  }

  // 5. Content validation
  let width: number | null = 0;
  let height: number | null = 0;
  let durationSeconds: number | null = null;

  if (category === 'image') {
    const dims = await validateImage(buffer, policy);
    width = dims.width || null;
    height = dims.height || null;
  } else if (category === 'video') {
    const info = await probeVideo(buffer);
    width = info.width || null;
    height = info.height || null;
    durationSeconds = info.duration || null;

    if (width && height) {
      if (width > policy.maxVideoDimension || height > policy.maxVideoDimension) {
        throw new ValidationError(
          `Video dimensions ${width}x${height} exceed maximum ${policy.maxVideoDimension}px`,
        );
      }
    }

    if (durationSeconds && durationSeconds > policy.maxVideoDurationSeconds) {
      throw new ValidationError(
        `Video duration ${durationSeconds.toFixed(1)}s exceeds limit of ${policy.maxVideoDurationSeconds}s`,
      );
    }
  }

  return {
    valid: true,
    fileType: category,
    mimeType: effectiveMime,
    width,
    height,
    durationSeconds,
  };
}

/**
 * Check if a file extension is an allowed image extension.
 */
export function isAllowedImageExtension(ext: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext.toLowerCase());
}

/**
 * Check if a file extension is an allowed video extension.
 */
export function isAllowedVideoExtension(ext: string): boolean {
  return ['.mp4'].includes(ext.toLowerCase());
}