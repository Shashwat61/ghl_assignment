import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * General API middleware applied to all /api/* routes.
 * - Attaches a unique request ID for tracing
 * - Logs incoming requests
 * - Adds standard response headers
 */
export function apiMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Powered-By', 'GHL-Copilot');

  const start = Date.now();
  console.log(`→ [${requestId}] ${req.method} ${req.path}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `← [${requestId}] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
}

/**
 * Global error handler — catches any error passed via next(err).
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred.',
  });
}
