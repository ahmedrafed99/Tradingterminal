import type { Request, Response, RequestHandler } from 'express';
import { isConnected, getAdapter } from '../adapters/registry';

/**
 * Middleware wrapper that checks exchange connection and provides
 * consistent error handling for route handlers.
 *
 * Usage:
 *   router.get('/', withConnection(async (req, res) => {
 *     const data = await getAdapter().accounts.list();
 *     res.json(data);
 *   }));
 */
export function withConnection(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response) => {
    if (!isConnected()) {
      res.status(401).json({ success: false, errorMessage: 'Not connected' });
      return;
    }
    try {
      await handler(req, res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[withConnection]', msg);
      res.status(502).json({ success: false, errorMessage: 'Exchange request failed' });
    }
  };
}

export { getAdapter };
