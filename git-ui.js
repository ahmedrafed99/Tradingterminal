#!/usr/bin/env node
const http = require('http');
const { exec } = require('child_process');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 3939;
const CWD = process.cwd();
const HTML_FILE = path.join(__dirname, 'git-ui.html');

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: CWD, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) reject(stderr || err.message);
      else resolve(stdout.trim());
    });
  });
}

async function parseStatus() {
  const out = await run('git status --porcelain -u');
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const xy = line.slice(0, 2);
    const file = line.slice(3).replace(/^"(.*)"$/, '$1');
    const staged = xy[0] !== ' ' && xy[0] !== '?';
    const untracked = xy === '??';
    return { file, staged, untracked, status: xy };
  });
}

async function getLog() {
  const out = await run('git log -20 --format=%H%x09%s%x09%an%x09%ar');
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const [hash, subject, author, date] = line.split('\t');
    return { hash: hash || '', subject: subject || '', author: author || '', date: date || '', short: (hash || '').slice(0, 7) };
  });
}

const ROUTES = {
  'GET /api/status': async () => ({ files: await parseStatus() }),

  'GET /api/log': async () => ({ commits: await getLog() }),

  'GET /api/branch': async () => ({ name: await run('git rev-parse --abbrev-ref HEAD') }),

  'GET /api/diff': async (q) => {
    const file = q.file;
    if (!file) throw new Error('No file');
    let diff = '';
    try { diff = await run('git diff -- "' + file + '"'); } catch {}
    if (!diff) { try { diff = await run('git diff --cached -- "' + file + '"'); } catch {} }
    return { diff };
  },

  'GET /api/show': async (q) => {
    const hash = q.hash;
    if (!hash || !/^[a-f0-9]+$/.test(hash)) throw new Error('Invalid hash');
    const diff = await run('git show ' + hash + ' --stat --patch');
    return { diff };
  },

  'POST /api/stage': async (_, b) => { await run('git add -- "' + b.file + '"'); return { ok: true }; },

  'POST /api/stage-all': async () => { await run('git add -A'); return { ok: true }; },

  'POST /api/unstage': async (_, b) => { await run('git reset HEAD -- "' + b.file + '"'); return { ok: true }; },

  'POST /api/discard': async (_, b) => { await run('git checkout -- "' + b.file + '"'); return { ok: true }; },

  'POST /api/discard-all': async () => { await run('git checkout -- .'); return { ok: true }; },

  'POST /api/commit': async (_, b) => {
    const msg = b.message.replace(/"/g, '\\"');
    await run('git commit -m "' + msg + '"');
    return { ok: true };
  },

  'POST /api/commit-all': async (_, b) => {
    await run('git add -A');
    const msg = b.message.replace(/"/g, '\\"');
    await run('git commit -m "' + msg + '"');
    return { ok: true };
  },

  'POST /api/amend': async (_, b) => {
    if (b.message) {
      const msg = b.message.replace(/"/g, '\\"');
      await run('git commit --amend -m "' + msg + '"');
    } else {
      await run('git commit --amend --no-edit');
    }
    return { ok: true };
  },

  'POST /api/push': async () => { await run('git push'); return { ok: true }; },

  'POST /api/pull': async () => { await run('git pull'); return { ok: true }; },

  'POST /api/fetch': async () => { await run('git fetch'); return { ok: true }; },

  'POST /api/revert': async (_, b) => {
    const hash = b.hash;
    if (!hash || !/^[a-f0-9]+$/.test(hash)) throw new Error('Invalid hash');
    await run('git revert --no-edit ' + hash);
    return { ok: true };
  },
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const key = req.method + ' ' + parsed.pathname;

  if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('git-ui.html not found next to git-ui.js');
    }
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  const handler = ROUTES[key];
  if (!handler) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    let body = {};
    if (req.method === 'POST') {
      body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', d => data += d);
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Bad JSON')); } });
        req.on('error', reject);
      });
    }
    const result = await handler(parsed.query, body);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (e) {
    console.error('[' + key + ']', e.message);
    res.writeHead(400);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Git UI: http://localhost:' + PORT);
  console.log('Repo:   ' + CWD);
  const open = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(open + ' http://localhost:' + PORT);
});
