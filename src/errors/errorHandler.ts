import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Handle Express body-parser payload too large errors
  if ('type' in err && (err as { type: string }).type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      },
    });
    return;
  }

  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  logger.error(
    {
      err,
      message: err.message,
      stack: err.stack,
    },
    'Unhandled error',
  );

  const internalError = AppError.internal();
  res.status(internalError.statusCode).json(internalError.toJSON());
}