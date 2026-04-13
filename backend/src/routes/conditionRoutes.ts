import { Router } from 'express';
import { validateBody } from '../validate';
import { CreateConditionSchema, PatchConditionSchema } from '../types/condition';
import * as store from '../services/conditionStore';
import * as engine from '../services/conditionEngine';
import * as barAggregator from '../services/barAggregator';
import * as tickAggregator from '../services/tickAggregator';

const router = Router();

// ---------------------------------------------------------------------------
// SSE — GET /conditions/events
// ---------------------------------------------------------------------------

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n'); // flush headers
  engine.addSSEClient(res);

  // Send current state as initial snapshot
  res.write(`event: snapshot\ndata: ${JSON.stringify(store.getAll())}\n\n`);
});

// ---------------------------------------------------------------------------
// GET /conditions
// ---------------------------------------------------------------------------

router.get('/', (_req, res) => {
  res.json(store.getAll());
});

// ---------------------------------------------------------------------------
// GET /conditions/:id
// ---------------------------------------------------------------------------

router.get('/:id', (req, res) => {
  const condition = store.getById(req.params.id);
  if (!condition) {
    res.status(404).json({ success: false, errorMessage: 'Condition not found' });
    return;
  }
  res.json(condition);
});

// ---------------------------------------------------------------------------
// POST /conditions
// ---------------------------------------------------------------------------

router.post('/', validateBody(CreateConditionSchema), (req, res) => {
  const condition = store.create(req.body);
  barAggregator.reschedule(); // recompute next candle boundary for the new condition
  tickAggregator.refreshBoundaryTimers(); // start boundary timer for new condition if frontend connected
  res.status(201).json(condition);
});

// ---------------------------------------------------------------------------
// PATCH /conditions/:id
// ---------------------------------------------------------------------------

router.patch('/:id', validateBody(PatchConditionSchema), (req, res) => {
  const updated = store.update(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ success: false, errorMessage: 'Condition not found' });
    return;
  }
  res.json(updated);
});

// ---------------------------------------------------------------------------
// POST /conditions/:id/pause
// ---------------------------------------------------------------------------

router.post('/:id/pause', (req, res) => {
  const condition = store.getById(req.params.id);
  if (!condition) {
    res.status(404).json({ success: false, errorMessage: 'Condition not found' });
    return;
  }
  if (condition.status !== 'armed') {
    res.status(400).json({ success: false, errorMessage: 'Only armed conditions can be paused' });
    return;
  }
  const updated = store.setStatus(req.params.id, 'paused');
  res.json(updated);
});

// ---------------------------------------------------------------------------
// POST /conditions/:id/resume
// ---------------------------------------------------------------------------

router.post('/:id/resume', (req, res) => {
  const condition = store.getById(req.params.id);
  if (!condition) {
    res.status(404).json({ success: false, errorMessage: 'Condition not found' });
    return;
  }
  if (condition.status !== 'paused') {
    res.status(400).json({ success: false, errorMessage: 'Only paused conditions can be resumed' });
    return;
  }
  const updated = store.setStatus(req.params.id, 'armed');
  barAggregator.reschedule();
  tickAggregator.refreshBoundaryTimers();
  res.json(updated);
});

// ---------------------------------------------------------------------------
// DELETE /conditions/:id
// ---------------------------------------------------------------------------

router.delete('/:id', (req, res) => {
  const removed = store.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ success: false, errorMessage: 'Condition not found' });
    return;
  }
  res.json({ success: true });
});

export default router;
