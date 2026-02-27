import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { hlClient } from '../services/hlClient';

const router = Router();

/**
 * GET /api/agents
 * Returns all Voice AI agents for the authenticated location.
 */
router.get(
  '/agents',
  requireAuth,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const agents = await hlClient.getAgents();
      res.json({ agents });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/agents/:id
 * Returns a single Voice AI agent by ID.
 */
router.get(
  '/agents/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = await hlClient.getAgent(req.params.id);
      res.json({ agent });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
