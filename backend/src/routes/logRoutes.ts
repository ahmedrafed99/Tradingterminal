import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();
const LOG_DIR = path.resolve(__dirname, '../../..', 'log');

router.post('/', (req: Request, res: Response) => {
  const { lines } = req.body as { lines?: unknown };
  if (!Array.isArray(lines)) {
    res.status(400).json({ ok: false });
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `debug-${date}.log`);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFile(file, lines.filter(l => typeof l === 'string').join('\n') + '\n', () => {});
  res.json({ ok: true });
});

export default router;
