import { Router } from 'express';

const router = Router();

// In-memory queue of drawings waiting to be picked up by the frontend
let pendingDrawings: Record<string, unknown>[] = [];

// POST /drawings/add — push a drawing into the queue
router.post('/add', (req, res) => {
  const drawing = req.body;
  if (!drawing || !drawing.type) {
    res.status(400).json({ success: false, errorMessage: 'Missing drawing type' });
    return;
  }
  // Auto-generate id if not provided
  if (!drawing.id) {
    drawing.id = crypto.randomUUID();
  }
  pendingDrawings.push(drawing);
  res.json({ success: true, id: drawing.id });
});

// GET /drawings/pending — frontend polls this, returns and clears queue
router.get('/pending', (_req, res) => {
  const drawings = pendingDrawings;
  pendingDrawings = [];
  res.json({ drawings });
});

// DELETE /drawings/clear — clear the queue
router.delete('/clear', (_req, res) => {
  pendingDrawings = [];
  res.json({ success: true });
});

export default router;
