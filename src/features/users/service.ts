import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface ProfileResponse {
  id: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

export async function getProfile(userId: string): Promise<ProfileResponse> {
  const db = getDatabase();

  const row = await db
    .selectFrom('users')
    .leftJoin('profiles', 'profiles.user_id', 'users.id')
    .select([
      'users.id',
      'users.email',
      'profiles.display_name',
      'profiles.bio',
      'profiles.avatar_url',
      sql<string>`COALESCE(profiles.created_at, users.created_at)`.as('created_at'),
      sql<string>`COALESCE(profiles.updated_at, users.updated_at)`.as('updated_at'),
    ])
    .where('users.id', '=', userId)
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('User not found');
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<ProfileResponse> {
  const db = getDatabase();

  if (input.displayName === undefined && input.bio === undefined && input.avatarUrl === undefined) {
    return getProfile(userId);
  }

  // Check if profile exists
  const existing = await db
    .selectFrom('profiles')
    .select('id')
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const now = new Date().toISOString();

  if (existing) {
    // Update
    const updateFields: Record<string, string> = { updated_at: now };
    if (input.displayName !== undefined) {
      updateFields.display_name = input.displayName;
    }
    if (input.bio !== undefined) {
      updateFields.bio = input.bio;
    }
    if (input.avatarUrl !== undefined) {
      updateFields.avatar_url = input.avatarUrl;
    }

    await db
      .updateTable('profiles')
      .set(updateFields)
      .where('user_id', '=', userId)
      .execute();
  } else {
    // Insert
    const insertFields: Record<string, string | null> = {
      user_id: userId,
      created_at: now,
      updated_at: now,
    };
    if (input.displayName !== undefined) {
      insertFields.display_name = input.displayName;
    }
    if (input.bio !== undefined) {
      insertFields.bio = input.bio;
    }
    if (input.avatarUrl !== undefined) {
      insertFields.avatar_url = input.avatarUrl;
    }

    await db.insertInto('profiles').values(insertFields as never).execute();
  }

  return getProfile(userId);
}