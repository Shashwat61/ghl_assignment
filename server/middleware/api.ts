import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';

/**
 * General API middleware applied to all /api/* routes.
 * - Attaches a unique request ID for tracing
 * - Logs incoming requests and responses via winston
 * - Adds standard response headers
 */
export function apiMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Powered-By', 'GHL-Copilot');

  const start = Date.now();
  logger.info(`→ ${req.method} ${req.path}`, { requestId });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`, { requestId });
  });

  next();
}

/**
 * Global error handler — catches any error passed via next(err).
 * Logs the full stack trace via winston.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = req.headers['x-request-id'] as string | undefined;
  logger.error(`${req.method} ${req.path} — ${err.message}`, {
    requestId,
    stack: err.stack,
    name: err.name,
  });
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred.',
  });
}
