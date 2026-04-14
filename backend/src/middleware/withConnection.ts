import type { Request, Response, RequestHandler } from 'express';
import { isConnected, getAdapter } from '../adapters/registry';

/**
 * Resolve the exchange adapter for a request.
 * Checks `exchange` in query string first, then request body, then falls back to default.
 */
export function resolveAdapter(req: Request) {
  const exchangeId =
    (req.query['exchange'] as string | undefined) ??
    (req.body?.exchange as string | undefined);
  return getAdapter(exchangeId);
}

/**
 * Middleware wrapper that checks exchange connection and provides
 * consistent error handling for route handlers.
 *
 * Usage:
 *   router.get('/', withConnection(async (req, res) => {
 *     const data = resolveAdapter(req).accounts.list();
 *     res.json(data);
 *   }));
 */
export function withConnection(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response) => {
    const exchangeId =
      (req.query['exchange'] as string | undefined) ??
      (req.body?.exchange as string | undefined);
    if (!isConnected(exchangeId)) {
      res.status(401).json({ success: false, errorMessage: 'Not connected' });
      return;
    }
    try {
      await handler(req, res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[withConnection]', msg);
      res.status(502).json({ success: false, errorMessage: msg });
    }
  };
}

export { getAdapter };
