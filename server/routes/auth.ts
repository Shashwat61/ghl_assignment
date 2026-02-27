import { Router, Request, Response } from 'express';
import { config } from '../config';
import { hlClient } from '../services/hlClient';
import { sessionStore } from '../services/sessionStore';

const router = Router();

/**
 * GET /auth
 * Redirects the user to HighLevel OAuth consent screen.
 */
router.get('/auth', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: config.hl.redirectUri,
    client_id: config.hl.clientId,
    scope: config.hl.scopes.join(' '),
  });

  const authUrl = `${config.hl.authBaseUrl}/oauth/chooselocation?${params.toString()}`;
  res.redirect(authUrl);
});

/**
 * GET /redirect  (HL OAuth callback)
 * Also aliased as GET /auth/callback for flexibility.
 * Exchanges the authorization code for tokens and stores in sessionStore.
 */
async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    res.redirect('/?error=oauth_denied');
    return;
  }

  if (!code || typeof code !== 'string') {
    res.redirect('/?error=missing_code');
    return;
  }

  try {
    const tokens = await hlClient.exchangeCode(code);

    // HL may return locationId directly or we fetch from /oauth/me
    let locationId = tokens.locationId || '';
    let userId = tokens.userId;
    let companyId = tokens.companyId;

    if (!locationId) {
      const userInfo = await hlClient.getUserInfo();
      locationId = userInfo.locationId || '';
      userId = userInfo.userId;
      companyId = userInfo.companyId;
    }

    sessionStore.set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      locationId,
      userId,
      companyId,
    });

    console.log(`✓ OAuth success — locationId: ${locationId || '(none)'}`);
    res.redirect('/');
  } catch (err) {
    console.error('OAuth token exchange failed:', err);
    res.redirect('/?error=token_exchange_failed');
  }
}

router.get('/redirect', handleOAuthCallback);
router.get('/auth/callback', handleOAuthCallback);

/**
 * GET /auth/status
 * Returns current authentication state.
 */
router.get('/auth/status', (_req: Request, res: Response) => {
  const session = sessionStore.get();
  if (!session || !sessionStore.hasValidToken()) {
    res.json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    locationId: session.locationId,
    userId: session.userId,
    expiresAt: session.expiresAt,
  });
});

/**
 * GET /auth/logout
 * Clears the session.
 */
router.get('/auth/logout', (_req: Request, res: Response) => {
  sessionStore.clear();
  res.json({ success: true, message: 'Logged out successfully.' });
});

export default router;
