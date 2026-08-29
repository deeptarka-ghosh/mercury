import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { env } from '../../config/env.js';
import type { MediaStorage } from './types.js';

/**
 * Local filesystem storage implementation.
 * Stores media files under the configured upload directory,
 * organized into date-based subdirectories (YYYY/MM/DD) to
 * avoid single-directory scaling issues.
 *
 * To swap for object storage: implement the MediaStorage interface
 * and update `createStorage()` to return the new implementation.
 */
export class LocalMediaStorage implements MediaStorage {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  /**
   * Generate a storage path relative to the base directory.
   * Uses date-based prefix + UUID filename to avoid collisions.
   */
  private generateStoragePath(filename: string): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    // Keep the original extension from the filename but prefix with a timestamp-based unique id
    const ext = filename.includes('.') ? filename.split('.').pop()! : 'bin';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    return `${year}/${month}/${day}/${uniqueName}`;
  }

  async store(filename: string, content: Buffer): Promise<string> {
    const relPath = this.generateStoragePath(filename);
    const fullPath = join(this.baseDir, relPath);
    await this.ensureDir(dirname(fullPath));
    await writeFile(fullPath, content);
    return relPath;
  }

  async retrieve(storagePath: string): Promise<Buffer> {
    const fullPath = join(this.baseDir, storagePath);
    return await readFile(fullPath);
  }

  async delete(storagePath: string): Promise<void> {
    const fullPath = join(this.baseDir, storagePath);
    await unlink(fullPath);
  }

  getUrl(storagePath: string): string {
    // Local storage returns a relative URL path served by the app
    return `/media/${storagePath}`;
  }
}

let storageInstance: MediaStorage | null = null;

/**
 * Create (or return existing) storage instance.
 * Uses env.UPLOAD_DIR as the base directory.
 */
export function createStorage(): MediaStorage {
  if (storageInstance) {
    return storageInstance;
  }
  storageInstance = new LocalMediaStorage(env.UPLOAD_DIR);
  return storageInstance;
}

/**
 * Get the current storage instance. Throws if not initialized.
 */
export function getStorage(): MediaStorage {
  if (!storageInstance) {
    throw new Error('Media storage not initialized. Call createStorage() first.');
  }
  return storageInstance;
}

/**
 * Reset storage instance (for testing).
 */
export function resetStorage(): void {
  storageInstance = null;
}