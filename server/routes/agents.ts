import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { hlClient } from '../services/hlClient';
import { sessionStore } from '../services/sessionStore';

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

/**
 * POST /api/settings/anthropic-key
 * Stores a user-supplied Anthropic API key in session (overrides env var).
 * GET /api/settings/anthropic-key — returns whether a custom key is set.
 */
router.post(
  '/settings/anthropic-key',
  (req: Request, res: Response) => {
    const { apiKey } = req.body as { apiKey: string };
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-ant-')) {
      res.status(400).json({ error: 'Invalid API key — must start with sk-ant-' });
      return;
    }
    sessionStore.setAnthropicApiKey(apiKey.trim());
    res.json({ success: true });
  },
);

router.get(
  '/settings/anthropic-key',
  (_req: Request, res: Response) => {
    const sessionKey = sessionStore.getAnthropicApiKey();
    res.json({
      hasCustomKey: !!sessionKey,
      keyReady: !!sessionKey,
      keyPreview: sessionKey ? `sk-ant-...${sessionKey.slice(-4)}` : null,
    });
  },
);

export default router;
