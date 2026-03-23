import { Router, Response } from 'express';
import crypto from 'crypto';

const router = Router();

// SSE client registry
const sseClients = new Set<Response>();

function broadcast(drawing: Record<string, unknown>): void {
  const payload = `data: ${JSON.stringify(drawing)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// GET /drawings/events — SSE stream for real-time drawing push
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.add(res);
  const cleanup = () => sseClients.delete(res);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

// POST /drawings/add — push a drawing to all connected frontends
router.post('/add', (req, res) => {
  const drawing = req.body;
  if (!drawing || !drawing.type) {
    res.status(400).json({ success: false, errorMessage: 'Missing drawing type' });
    return;
  }
  if (!drawing.id) {
    drawing.id = crypto.randomUUID();
  }
  broadcast(drawing);
  res.json({ success: true, id: drawing.id });
});

// DELETE /drawings/remove/:id — remove a specific drawing by id
router.delete('/remove/:id', (req, res) => {
  broadcast({ _command: 'remove', id: req.params.id });
  res.json({ success: true });
});

// POST /drawings/clear-chart — broadcast clear command to all frontends
router.post('/clear-chart', (_req, res) => {
  broadcast({ _command: 'clearAll' });
  res.json({ success: true });
});

export default router;
