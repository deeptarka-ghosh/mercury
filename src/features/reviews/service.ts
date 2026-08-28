import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';
import { getProductBySlug } from '../catalog/service.js';

export interface ReviewResponse {
  id: string;
  userId: string;
  productId: string;
  rating: number;
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductReviewsResponse {
  reviews: ReviewResponse[];
  averageRating: string | null;
  reviewCount: number;
}

function mapReview(row: {
  id: string;
  user_id: string;
  product_id: string;
  rating: number;
  content: string | null;
  created_at: string;
  updated_at: string | undefined;
}): ReviewResponse {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    rating: row.rating,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

/**
 * Create a review for an active product by slug.
 * Uses a transaction to ensure the product is active and the unique constraint
 * prevents duplicate reviews from the same user on the same product.
 */
export async function createReview(
  userId: string,
  productSlug: string,
  rating: number,
  content: string | null,
): Promise<ReviewResponse> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw AppError.badRequest('rating must be an integer between 1 and 5');
  }

  // Verify product exists and is active (reuses catalog logic)
  const product = await getProductBySlug(productSlug);

  const db = getDatabase();

  const row = await db.transaction().execute(async (trx) => {
    try {
      const result = await sql<{
        id: string;
        user_id: string;
        product_id: string;
        rating: number;
        content: string | null;
        created_at: string;
        updated_at: string;
      }>`
        INSERT INTO reviews (user_id, product_id, rating, content, created_at, updated_at)
        VALUES (${userId}, ${product.id}, ${rating}, ${content}, now(), now())
        RETURNING id, user_id, product_id, rating, content, created_at, updated_at
      `.execute(trx);

      return result.rows[0]!;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505' // unique_violation
      ) {
        throw AppError.conflict('You have already reviewed this product');
      }
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23514' // check_violation
      ) {
        throw AppError.badRequest('rating must be between 1 and 5');
      }
      throw err;
    }
  });

  return mapReview(row);
}

/**
 * Get all reviews for an active product by slug.
 * Includes aggregate rating information from a single PostgreSQL query.
 */
export async function getProductReviews(productSlug: string): Promise<ProductReviewsResponse> {
  // Verify product exists and is active (reuses catalog logic)
  const product = await getProductBySlug(productSlug);

  const db = getDatabase();

  const rows = await db
    .selectFrom('reviews')
    .select([
      'reviews.id',
      'reviews.user_id',
      'reviews.product_id',
      'reviews.rating',
      'reviews.content',
      'reviews.created_at',
      'reviews.updated_at',
    ])
    .where('reviews.product_id', '=', product.id)
    .orderBy('reviews.created_at')
    .execute();

  const reviews = rows.map(mapReview);

  // Aggregate in a separate query — simpler than mixing with row data
  const agg = await db
    .selectFrom('reviews')
    .select([
      sql<string | null>`CAST(AVG(reviews.rating) AS TEXT)`.as('average_rating'),
      sql<number>`CAST(COUNT(*) AS INTEGER)`.as('review_count'),
    ])
    .where('reviews.product_id', '=', product.id)
    .executeTakeFirstOrThrow();

  return {
    reviews,
    averageRating: agg.average_rating ?? null,
    reviewCount: agg.review_count,
  };
}

/**
 * Get all reviews written by the current user, ordered by most recent first.
 */
export async function getMyReviews(userId: string): Promise<ReviewResponse[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('reviews')
    .select([
      'reviews.id',
      'reviews.user_id',
      'reviews.product_id',
      'reviews.rating',
      'reviews.content',
      'reviews.created_at',
      'reviews.updated_at',
    ])
    .where('reviews.user_id', '=', userId)
    .orderBy('reviews.created_at', 'desc')
    .execute();

  return rows.map(mapReview);
}

/**
 * Update the current user's own review.
 * Ownership is enforced by filtering on both review ID and user ID.
 */
export async function updateMyReview(
  userId: string,
  reviewId: string,
  rating: number | undefined,
  content: string | null | undefined,
): Promise<ReviewResponse> {
  if (rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw AppError.badRequest('rating must be an integer between 1 and 5');
    }
  }

  if (rating === undefined && content === undefined) {
    throw AppError.badRequest('Nothing to update');
  }

  const db = getDatabase();

  // Ensure the review exists and belongs to the user
  const existing = await db
    .selectFrom('reviews')
    .select(['id'])
    .where('reviews.id', '=', reviewId)
    .where('reviews.user_id', '=', userId)
    .executeTakeFirst();

  if (!existing) {
    throw AppError.notFound('Review not found');
  }

  // Build set object, handling undefined (unchanged) vs null (clear) explicitly
  const setFields: Record<string, unknown> = {
    updated_at: sql`now()`,
  };
  if (rating !== undefined) {
    setFields.rating = rating;
  }
  if (content !== undefined) {
    setFields.content = content;
  }

  await db
    .updateTable('reviews')
    .set(setFields as never)
    .where('reviews.id', '=', reviewId)
    .execute();

  // Fetch updated state
  const row = await db
    .selectFrom('reviews')
    .select([
      'reviews.id',
      'reviews.user_id',
      'reviews.product_id',
      'reviews.rating',
      'reviews.content',
      'reviews.created_at',
      'reviews.updated_at',
    ])
    .where('reviews.id', '=', reviewId)
    .executeTakeFirstOrThrow();

  return mapReview(row);
}

/**
 * Delete the current user's own review.
 * Ownership is enforced by filtering on both review ID and user ID.
 */
export async function deleteMyReview(userId: string, reviewId: string): Promise<void> {
  const db = getDatabase();

  const result = await db
    .deleteFrom('reviews')
    .where('reviews.id', '=', reviewId)
    .where('reviews.user_id', '=', userId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw AppError.notFound('Review not found');
  }
}