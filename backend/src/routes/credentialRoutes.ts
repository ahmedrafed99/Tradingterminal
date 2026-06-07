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
const DEFAULT_BASE_URL = 'https://api.topstepx.com';

// ---------------------------------------------------------------------------
// Encryption helpers — AES-256-GCM with a machine-derived key
// ---------------------------------------------------------------------------

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
// Profile type
// ---------------------------------------------------------------------------

interface CredentialProfile {
  id: string;
  userName: string;
  apiKey: string;
  baseUrl?: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// Read/write helpers with migration shim
// ---------------------------------------------------------------------------

async function readProfiles(): Promise<CredentialProfile[]> {
  try {
    const raw = await fs.readFile(CREDS_FILE, 'utf-8');
    const decrypted = decrypt(raw);
    const data = JSON.parse(decrypted);
    // Migration: legacy single-credential object → array
    if (!Array.isArray(data)) {
      if (data && typeof data === 'object' && (data as Record<string, unknown>)['userName']) {
        const legacy = data as { userName: string; apiKey?: string };
        return [{
          id: legacy.userName,
          userName: legacy.userName,
          apiKey: legacy.apiKey ?? '',
          baseUrl: DEFAULT_BASE_URL,
        }];
      }
      return [];
    }
    return data as CredentialProfile[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (err instanceof Error && (err.message.includes('Unsupported state') || err.message.includes('unable to authenticate'))) {
      return [];
    }
    throw err;
  }
}

async function writeProfiles(profiles: CredentialProfile[]): Promise<void> {
  const encrypted = encrypt(JSON.stringify(profiles));
  await fs.writeFile(CREDS_FILE, encrypted, 'utf-8');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /credentials — return all profiles
router.get('/', async (_req, res) => {
  try {
    await ensureDir();
    const profiles = await readProfiles();
    res.json({ success: true, data: profiles });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

const ProfileSchema = z.object({
  id: z.string(),
  userName: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  label: z.string().optional(),
});

// PUT /credentials/:id — upsert one profile
router.put('/:id', validateBody(ProfileSchema), async (req, res) => {
  try {
    await ensureDir();
    const profiles = await readProfiles();
    const profile = req.body as z.infer<typeof ProfileSchema>;
    const idx = profiles.findIndex((p) => p.id === req.params['id']);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    await writeProfiles(profiles);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// DELETE /credentials/:id — remove one profile
router.delete('/:id', async (req, res) => {
  try {
    await ensureDir();
    const profiles = await readProfiles();
    await writeProfiles(profiles.filter((p) => p.id !== req.params['id']));
    res.json({ success: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      res.json({ success: true });
      return;
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// DELETE /credentials — remove all
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
