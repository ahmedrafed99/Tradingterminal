import { Router } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { validateBody } from '../validate';

const router = Router();

const DATA_DIR = path.resolve(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'user-settings.json');

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// GET /settings — load persisted settings from disk
router.get('/', async (_req, res) => {
  try {
    await ensureDir();
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    res.json({ success: true, data: JSON.parse(raw) });
  } catch (err: unknown) {
    // File doesn't exist yet — return empty object
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      res.json({ success: true, data: {} });
      return;
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// PUT /settings — save settings to disk
const SettingsBodySchema = z.record(z.string(), z.unknown());

router.put('/', validateBody(SettingsBodySchema), async (req, res) => {
  try {
    await ensureDir();
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

export default router;
