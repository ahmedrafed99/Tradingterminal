import type { Request, Response, RequestHandler } from 'express';
import { isConnected, getAdapter, getAdapterForAccount } from '../adapters/registry';

/**
 * Resolve the exchange adapter for a request.
 * Priority: accountId → explicit exchange/connectionId → default.
 */
export function resolveAdapter(req: Request) {
  // 1. Route by accountId (present in most order/trade/position requests)
  const accountId =
    (req.body?.accountId as string | undefined) ??
    (req.query['accountId'] as string | undefined);
  if (accountId) return getAdapterForAccount(accountId);

  // 2. Fall back to explicit exchange/connectionId or default
  const exchangeId =
    (req.query['exchange'] as string | undefined) ??
    (req.body?.exchange as string | undefined);
  return getAdapter(exchangeId);
}

/**
 * Middleware wrapper that checks any exchange connection and provides
 * consistent error handling for route handlers.
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
      res.status(502).json({ success: false, errorMessage: msg });
    }
  };
}

export { getAdapter };
