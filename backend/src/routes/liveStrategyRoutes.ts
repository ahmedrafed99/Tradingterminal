import { Router } from 'express';
import { z } from 'zod';
import * as manager from '../services/liveStrategyManager';

const router = Router();

router.get('/', (_req, res) => {
  res.json(manager.listStrategies());
});

router.get('/events', (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  manager.addSSEClient(res);
  res.write(`event: snapshot\ndata: ${JSON.stringify(manager.listStrategies())}\n\n`);
});

router.get('/:id', (req, res) => {
  const info = manager.getStrategy(req.params.id);
  if (!info) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(info);
});

const StartSchema = z.object({
  accountId: z.string().min(1),
  contractId: z.string().min(1),
  contractName: z.string().optional(),
  tickSize: z.number().positive().default(0.25),
});

router.post('/:id/start', async (req, res) => {
  const parsed = StartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid config', details: parsed.error.message });
    return;
  }
  try {
    // Validate / check state synchronously before firing
    const info = manager.getStrategy(req.params.id);
    if (!info) { res.status(404).json({ error: 'Not found' }); return; }

    // Fire async — SSE broadcasts handle all status updates
    manager.startStrategy(req.params.id, parsed.data).catch(() => {});
    res.json(manager.getStrategy(req.params.id));
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    await manager.stopStrategy(req.params.id);
    res.json(manager.getStrategy(req.params.id));
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const TestSignalSchema = z.object({
  direction: z.enum(['long', 'short']),
});

router.post('/:id/test-signal', async (req, res) => {
  const parsed = TestSignalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'direction must be "long" or "short"' });
    return;
  }
  try {
    await manager.testSignalStrategy(req.params.id, parsed.data.direction);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
