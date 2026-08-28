import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
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