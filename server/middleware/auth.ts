import { Request, Response, NextFunction } from 'express';
import { sessionStore } from '../services/sessionStore';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!sessionStore.hasValidToken()) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Please connect your HighLevel account first.',
    });
    return;
  }
  next();
}
