import { Router } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { z } from 'zod';
import { validateBody } from '../validate';

const router = Router();

const DATA_DIR = path.resolve(__dirname, '../../data');
const CREDS_FILE = path.join(DATA_DIR, '.credentials.enc');

// ---------------------------------------------------------------------------
// Encryption helpers — AES-256-GCM with a machine-derived key
// ---------------------------------------------------------------------------

/** Derive a stable encryption key from machine-specific identifiers */
function deriveKey(): Buffer {
  const machineId = `${os.hostname()}:${os.homedir()}:trading-terminal`;
  return crypto.scryptSync(machineId, 'trading-terminal-salt', 32);
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(packed: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, dataHex] = packed.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /credentials — load saved credentials
router.get('/', async (_req, res) => {
  try {
    await ensureDir();
    const raw = await fs.readFile(CREDS_FILE, 'utf-8');
    const decrypted = decrypt(raw);
    const data = JSON.parse(decrypted);
    res.json({ success: true, data });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      res.json({ success: true, data: null });
      return;
    }
    // Decryption failure (machine changed, tampered file) — treat as empty
    if (err instanceof Error && (err.message.includes('Unsupported state') || err.message.includes('unable to authenticate'))) {
      res.json({ success: true, data: null });
      return;
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// PUT /credentials — save credentials (encrypted)
const CredentialsSchema = z.object({
  userName: z.string(),
  apiKey: z.string(),
});

router.put('/', validateBody(CredentialsSchema), async (req, res) => {
  try {
    await ensureDir();
    const encrypted = encrypt(JSON.stringify(req.body));
    await fs.writeFile(CREDS_FILE, encrypted, 'utf-8');
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// DELETE /credentials — remove saved credentials
router.delete('/', async (_req, res) => {
  try {
    await fs.unlink(CREDS_FILE).catch(() => {});
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

export default router;
