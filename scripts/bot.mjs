#!/usr/bin/env node
/**
 * Bot CLI — thin wrapper around the trading terminal REST API.
 *
 * Usage:
 *   node scripts/bot.mjs <command> [options]
 *
 * Drawing:
 *   draw-hline   --price <n> [--label <text>] [--color <hex>] [--contractId <id>]
 *   draw-marker  --time <unix> --price <n> --label <text> --placement above|below [--color <hex>] [--contractId <id>]
 *   remove       --id <uuid>
 *   clear
 *
 * Orders:
 *   place-order  --accountId <id> --contractId <id> --side buy|sell --size <n> --type market|limit|stop [--price <n>] [--sl <ticks>] [--tp <ticks>]
 *   cancel-order --accountId <id> --orderId <id>
 *   modify-order --accountId <id> --orderId <id> [--price <n>] [--stopPrice <n>] [--size <n>]
 *
 * Read:
 *   get-position --accountId <id>
 *   get-orders   --accountId <id>
 *   get-trades   --accountId <id> --from <iso>
 *   get-bars     --contractId <id> --from <iso> --to <iso> [--unit <n>] [--unitNumber <n>]
 *   get-contracts
 */

const BASE = process.env.BOT_API_URL || 'http://localhost:3001';

// ── Helpers ──

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function del(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  return res.json();
}

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function require(args, ...keys) {
  for (const k of keys) {
    if (args[k] === undefined) die(`missing --${k}`);
  }
}

// ── Default style ──

const COLORS = {
  moveToLow: '#b05050',      // muted red — current move to low
  prevMoveToLow: '#8b6060',  // softer red — previous move to low (SOS target)
  moveToHigh: '#5b8a72',     // muted green — current move to high
  prevMoveToHigh: '#6b9a7a', // softer green — previous move to high (SOW target)
  neutral: '#787b86',
  sl: '#c13030',
  slPreview: '#7a4040',
  info: '#6b7ea0',
};

function makeText(content, color, hAlign = 'right') {
  return {
    content,
    color,
    fontSize: 12,
    bold: false,
    italic: false,
    hAlign,
    vAlign: 'middle',
  };
}

// ── Commands ──

const commands = {
  async 'draw-hline'(args) {
    require(args, 'price');
    const color = args.color || COLORS.neutral;
    const startTime = args.startTime ? Number(args.startTime) : 0;
    const extendLeft = startTime === 0;
    const result = await post('/drawings/add', {
      type: 'hline',
      price: Number(args.price),
      color,
      strokeWidth: Number(args.strokeWidth || 1),
      contractId: args.contractId || '',
      text: args.label ? makeText(args.label, color) : null,
      startTime,
      extendLeft,
    });
    console.log(JSON.stringify(result));
  },

  async 'draw-marker'(args) {
    require(args, 'time', 'price', 'label', 'placement');
    const result = await post('/drawings/add', {
      type: 'marker',
      time: Number(args.time),
      price: Number(args.price),
      color: args.color || COLORS.info,
      label: args.label,
      placement: args.placement,
      strokeWidth: 1,
      contractId: args.contractId || '',
      text: null,
    });
    console.log(JSON.stringify(result));
  },

  async 'remove'(args) {
    require(args, 'id');
    const result = await del(`/drawings/remove/${args.id}`);
    console.log(JSON.stringify(result));
  },

  async 'clear'() {
    const result = await post('/drawings/clear-chart', {});
    console.log(JSON.stringify(result));
  },

  async 'draw-analysis'(args) {
    require(args, 'contractId', 'date', 'side');
    const { loadSession, scanTradeManagement, wickMidpoint } = await import('./sos-technical-analysis.mjs');
    const opts = {};
    if (args.from) { const [h, m] = args.from.split(':').map(Number); opts.startMinute = h * 60 + m; }
    if (args.to) { const [h, m] = args.to.split(':').map(Number); opts.endMinute = h * 60 + m; }
    const s = await loadSession(args.contractId, args.date, opts);
    const side = args.side.toLowerCase();
    const cid = args.contractId;
    const fmt = (v) => v?.toFixed(2) ?? '—';

    // Helper to draw an hline
    async function hline(price, label, color, startTime) {
      return post('/drawings/add', {
        type: 'hline', price, color, strokeWidth: 1, contractId: cid,
        text: makeText(label, color),
        startTime: startTime || 0, extendLeft: !startTime,
      });
    }

    // Helper to draw a marker
    async function marker(time, price, label, placement, color) {
      return post('/drawings/add', {
        type: 'marker', time, price, color, label, placement,
        strokeWidth: 1, contractId: cid, text: null,
      });
    }

    // Clear existing drawings first
    await post('/drawings/clear-chart', {});

    if (side === 'long') {
      if (!s.sos) { console.log('No SOS detected'); return; }
      const sos = s.sos;
      const initialSL = wickMidpoint(sos.lowBar, 'long');
      const entryPrice = sos.invalidation?.level;
      const targetPrice = sos.importantTarget?.targetLevel;

      // Draw levels
      await hline(sos.moveToLow, 'Move to Low', COLORS.moveToLow, sos.lowBar.ts);
      if (sos.invalidation) await hline(entryPrice, 'Invalidation of Strength', COLORS.sl, sos.invalidation.bar.ts);
      await hline(initialSL, 'Stop Loss', COLORS.sl, sos.lowBar.ts);
      if (targetPrice) await hline(targetPrice, 'Important Target', COLORS.prevMoveToLow, sos.importantTarget.prevLowBar.ts);

      // Find entry fill candle
      if (sos.signOfStrength && entryPrice) {
        let fillTs = null;
        for (let i = sos.signOfStrength.index + 1; i < s.bars.length; i++) {
          if (s.bars[i].l <= entryPrice) { fillTs = s.bars[i].ts; break; }
        }
        if (fillTs) {
          await marker(fillTs, entryPrice, `Long Entry 1 @ ${fmt(entryPrice)}`, 'below', COLORS.moveToLow);

          // Find exit fill candle
          if (targetPrice) {
            const fillIdx = s.bars.findIndex(b => b.ts === fillTs);
            for (let i = fillIdx + 1; i < s.bars.length; i++) {
              if (s.bars[i].h >= targetPrice) {
                await marker(s.bars[i].ts, targetPrice, `Long Exit 1 @ ${fmt(targetPrice)}`, 'above', COLORS.moveToHigh);
                break;
              }
            }
          }

          // SL trail events
          const events = scanTradeManagement(s.bars, sos.signOfStrength.index, 'long');
          const exitTs = targetPrice ? (() => {
            const fi = s.bars.findIndex(b => b.ts === fillTs);
            for (let i = fi + 1; i < s.bars.length; i++) { if (s.bars[i].h >= targetPrice) return s.bars[i].ts; }
            return Infinity;
          })() : Infinity;

          for (let k = 0; k < events.length; k++) {
            const e = events[k];
            if (e.sowBar.ts >= exitTs) break;
            await hline(e.newSL, `SL Trail #${k + 1}`, COLORS.slPreview, e.lowestBar.ts);
          }
        }
      }

      console.log('Long analysis drawn for ' + args.date);

    } else {
      if (!s.sow) { console.log('No SOW detected'); return; }
      const sow = s.sow;
      const initialSL = wickMidpoint(sow.highBar, 'short');
      const entryPrice = sow.invalidation?.level;
      const targetPrice = sow.importantTarget?.targetLevel;

      // Draw levels
      await hline(sow.moveToHigh, 'Move to High', COLORS.moveToHigh, sow.highBar.ts);
      if (sow.invalidation) await hline(entryPrice, 'Invalidation of Weakness', COLORS.sl, sow.invalidation.bar.ts);
      await hline(initialSL, 'Stop Loss', COLORS.sl, sow.highBar.ts);
      if (targetPrice) await hline(targetPrice, 'Important Target', COLORS.prevMoveToHigh, sow.importantTarget.prevHighBar.ts);

      // Find entry fill candle
      if (sow.signOfWeakness && entryPrice) {
        let fillTs = null;
        for (let i = sow.signOfWeakness.index + 1; i < s.bars.length; i++) {
          if (s.bars[i].h >= entryPrice) { fillTs = s.bars[i].ts; break; }
        }
        if (fillTs) {
          await marker(fillTs, entryPrice, `Short Entry 1 @ ${fmt(entryPrice)}`, 'above', COLORS.moveToHigh);

          // Find exit fill candle
          if (targetPrice) {
            const fillIdx = s.bars.findIndex(b => b.ts === fillTs);
            for (let i = fillIdx + 1; i < s.bars.length; i++) {
              if (s.bars[i].l <= targetPrice) {
                await marker(s.bars[i].ts, targetPrice, `Short Exit 1 @ ${fmt(targetPrice)}`, 'below', COLORS.moveToLow);
                break;
              }
            }
          }

          // SL trail events
          const events = scanTradeManagement(s.bars, sow.signOfWeakness.index, 'short');
          const exitTs = targetPrice ? (() => {
            const fi = s.bars.findIndex(b => b.ts === fillTs);
            for (let i = fi + 1; i < s.bars.length; i++) { if (s.bars[i].l <= targetPrice) return s.bars[i].ts; }
            return Infinity;
          })() : Infinity;

          for (let k = 0; k < events.length; k++) {
            const e = events[k];
            if (e.sosBar.ts >= exitTs) break;
            await hline(e.newSL, `SL Trail #${k + 1}`, COLORS.slPreview, e.highestBar.ts);
          }
        }
      }

      console.log('Short analysis drawn for ' + args.date);
    }
  },

  async 'place-order'(args) {
    require(args, 'accountId', 'contractId', 'side', 'size', 'type');
    // Routes through frontend's placeOrderWithBrackets via SSE — same path as UI
    const body = {
      accountId: args.accountId,
      contractId: args.contractId,
      type: args.type.toLowerCase(),
      side: args.side.toLowerCase(),
      size: Number(args.size),
    };
    if (args.price) body.limitPrice = Number(args.price);
    if (args.stopPrice) body.stopPrice = Number(args.stopPrice);
    // SL/TP in ticks (unsigned) — frontend handles sign + bracket building
    if (args.sl) body.slTicks = Number(args.sl);
    if (args.tp) body.tpTicks = Number(args.tp);
    if (args.usePreset) body.usePreset = true;

    const result = await post('/drawings/place-order', body);
    console.log(JSON.stringify(result));
  },

  async 'cancel-order'(args) {
    require(args, 'accountId', 'orderId');
    const result = await post('/orders/cancel', {
      accountId: args.accountId,
      orderId: args.orderId,
    });
    console.log(JSON.stringify(result));
  },

  async 'modify-order'(args) {
    require(args, 'accountId', 'orderId');
    const body = { accountId: args.accountId, orderId: args.orderId };
    if (args.price) body.limitPrice = Number(args.price);
    if (args.stopPrice) body.stopPrice = Number(args.stopPrice);
    if (args.size) body.size = Number(args.size);
    const result = await patch('/orders/modify', body);
    console.log(JSON.stringify(result));
  },

  async 'get-position'(args) {
    require(args, 'accountId');
    const result = await get(`/positions/open?accountId=${args.accountId}`);
    console.log(JSON.stringify(result));
  },

  async 'get-orders'(args) {
    require(args, 'accountId');
    const result = await get(`/orders/open?accountId=${args.accountId}`);
    console.log(JSON.stringify(result));
  },

  async 'get-trades'(args) {
    require(args, 'accountId', 'from');
    let url = `/trades/search?accountId=${args.accountId}&startTimestamp=${args.from}`;
    if (args.to) url += `&endTimestamp=${args.to}`;
    const result = await get(url);
    console.log(JSON.stringify(result));
  },

  async 'get-bars'(args) {
    require(args, 'contractId', 'from', 'to');
    const result = await post('/market/bars', {
      contractId: args.contractId,
      live: false,
      unit: Number(args.unit || 2),
      unitNumber: Number(args.unitNumber || 1),
      startTime: args.from,
      endTime: args.to,
      limit: 20000,
      includePartialBar: true,
    });
    console.log(JSON.stringify(result));
  },

  async 'get-contracts'() {
    const result = await get('/market/contracts/available');
    console.log(JSON.stringify(result));
  },

  async 'analyze'(args) {
    require(args, 'contractId', 'date');
    const { loadSession } = await import('./sos-technical-analysis.mjs');
    const opts = {};
    if (args.from) { const [h, m] = args.from.split(':').map(Number); opts.startMinute = h * 60 + m; }
    if (args.to) { const [h, m] = args.to.split(':').map(Number); opts.endMinute = h * 60 + m; }
    const s = await loadSession(args.contractId, args.date, opts);

    if (!s.sos && !s.sow) {
      console.log('No structure detected (no bars in 7:30-9:20 ET window)');
      return;
    }

    const fmt = (v) => v?.toFixed(2) ?? '—';
    const time = (bar) => bar?.t?.slice(11, 19) ?? '—';

    if (s.sos) {
      console.log('── SOS ──');
      console.log(`  Low:                ${fmt(s.sos.lowBar.l)} @ ${time(s.sos.lowBar)}`);
      console.log(`  Move to Low:        ${fmt(s.sos.moveToLow)}`);
      console.log(`  Swing to Low:       ${fmt(s.sos.swingToLow)}`);
      console.log(`  Sign of Strength:   ${s.sos.signOfStrength ? fmt(s.sos.signOfStrength.level) + ' @ ' + time(s.sos.signOfStrength.bar) : '—'}`);
      console.log(`  Invalidation Level: ${s.sos.invalidation ? fmt(s.sos.invalidation.level) : '—'}`);
      console.log(`  Invalidated:        ${s.sos.invalidated ? 'YES @ ' + time(s.sos.invalidated.bar) : 'No'}`);
      console.log(`  Target (prev SOS):  ${s.sos.target?.targetLevel ? fmt(s.sos.target.targetLevel) : '—'}`);
      console.log(`  Important Target:   ${s.sos.importantTarget?.targetLevel ? fmt(s.sos.importantTarget.targetLevel) : '—'}`);
    }

    if (s.sow) {
      console.log('── SOW ──');
      console.log(`  High:               ${fmt(s.sow.highBar.h)} @ ${time(s.sow.highBar)}`);
      console.log(`  Move to High:       ${fmt(s.sow.moveToHigh)}`);
      console.log(`  Swing to High:      ${fmt(s.sow.swingToHigh)}`);
      console.log(`  Sign of Weakness:   ${s.sow.signOfWeakness ? fmt(s.sow.signOfWeakness.level) + ' @ ' + time(s.sow.signOfWeakness.bar) : '—'}`);
      console.log(`  Invalidation Level: ${s.sow.invalidation ? fmt(s.sow.invalidation.level) : '—'}`);
      console.log(`  Invalidated:        ${s.sow.invalidated ? 'YES @ ' + time(s.sow.invalidated.bar) : 'No'}`);
      console.log(`  Target (prev SOW):  ${s.sow.target?.targetLevel ? fmt(s.sow.target.targetLevel) : '—'}`);
      console.log(`  Important Target:   ${s.sow.importantTarget?.targetLevel ? fmt(s.sow.importantTarget.targetLevel) : '—'}`);
    }
  },

  async 'manage'(args) {
    require(args, 'contractId', 'date', 'side');
    const { loadSession, scanTradeManagement, wickMidpoint } = await import('./sos-technical-analysis.mjs');
    const s = await loadSession(args.contractId, args.date);
    const side = args.side.toLowerCase();

    const fmt = (v) => v?.toFixed(2) ?? '—';
    const time = (bar) => bar?.t?.slice(11, 19) ?? '—';

    // Determine start index (from sign of strength/weakness confirmation)
    let startIndex = null;
    let initialSL = null;

    if (side === 'long') {
      if (!s.sos?.signOfStrength) { console.log('No sign of strength found — no long trade to manage'); return; }
      startIndex = s.sos.signOfStrength.index;
      initialSL = wickMidpoint(s.sos.lowBar, 'long');
      console.log(`── Long Trade Management ──`);
      console.log(`  Entry after SOS @ ${time(s.sos.signOfStrength.bar)}`);
      console.log(`  Initial SL: ${fmt(initialSL)} (wick midpoint of low candle)`);
    } else {
      if (!s.sow?.signOfWeakness) { console.log('No sign of weakness found — no short trade to manage'); return; }
      startIndex = s.sow.signOfWeakness.index;
      initialSL = wickMidpoint(s.sow.highBar, 'short');
      console.log(`── Short Trade Management ──`);
      console.log(`  Entry after SOW @ ${time(s.sow.signOfWeakness.bar)}`);
      console.log(`  Initial SL: ${fmt(initialSL)} (wick midpoint of high candle)`);
    }

    const events = scanTradeManagement(s.bars, startIndex, side);

    if (events.length === 0) {
      console.log('  No SL trail events detected.');
    } else {
      for (let k = 0; k < events.length; k++) {
        const e = events[k];
        if (side === 'long') {
          console.log(`  Trail #${k + 1}:`);
          console.log(`    SOW @ ${time(e.sowBar)} — recovery @ ${time(e.recoveryBar)}`);
          console.log(`    Lowest point: ${fmt(e.lowestBar.l)} @ ${time(e.lowestBar)}`);
          console.log(`    New SL: ${fmt(e.newSL)}`);
        } else {
          console.log(`  Trail #${k + 1}:`);
          console.log(`    SOS @ ${time(e.sosBar)} — recovery @ ${time(e.recoveryBar)}`);
          console.log(`    Highest point: ${fmt(e.highestBar.h)} @ ${time(e.highestBar)}`);
          console.log(`    New SL: ${fmt(e.newSL)}`);
        }
      }
    }
  },

  async 'watch'(args) {
    require(args, 'contractId', 'accountId');
    const {
      fetchBars, findAnchorLow, findAnchorHigh, detectSOS, detectSOW,
      wickMidpoint, scanTradeManagement,
    } = await import('./sos-technical-analysis.mjs');

    const cid = args.contractId;
    const acct = args.accountId;
    const sideArg = args.side ? args.side.toLowerCase() : 'auto';
    let side = sideArg; // may be resolved to 'long' or 'short' in Phase 3
    const size = Number(args.size || 1);
    const manage = !!args.manage;
    const dryRun = !!args.dryRun;
    const startNow = !!args.now;
    const startAt = args.startAt || '7:30';
    const windowEndArg = args.windowEnd || '9:20';
    // anchorStartMinute removed — anchors now use full session (6 PM ET to 5 PM ET)
    const WINDOW_END = windowEndArg === '0' ? 0 : (() => {
      const [h, m] = windowEndArg.split(':').map(Number);
      return h * 60 + m;
    })();

    const fmt = (v) => v?.toFixed(2) ?? '—';
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Wait until the next 1m candle closes (:00 + 1.5s buffer for bar to finalize)
    async function sleepUntilNextCandle() {
      const now = Date.now();
      const ms = 60_000 - (now % 60_000) + 1500;
      await sleep(ms);
    }

    function log(msg) {
      const et = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
      console.log(`[${et}] ${msg}`);
    }

    function nowETMinutes() {
      const et = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
      const [h, m] = et.split(', ')[1].split(':').map(Number);
      return h * 60 + m;
    }

    function sessionStartISO() {
      // Futures session: 6 PM ET previous day → 5 PM ET today
      // Find the most recent 6 PM ET as the session start
      const now = new Date();
      const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
      const etHour = parseInt(etStr.split(', ')[1].split(':')[0]);
      const etOffset = now.getUTCHours() - etHour; // 4 for EDT, 5 for EST
      const etDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const y = etDate.getFullYear(), mo = etDate.getMonth(), d = etDate.getDate();
      // If current ET time is before 6 PM, session started yesterday at 6 PM
      // If current ET time is 6 PM or later, session started today at 6 PM
      const etMins = etDate.getHours() * 60 + etDate.getMinutes();
      if (etMins < 18 * 60) {
        // Session started yesterday at 6 PM ET
        const yesterday = new Date(Date.UTC(y, mo, d - 1, 18 + etOffset, 0, 0));
        return yesterday.toISOString();
      } else {
        // Session started today at 6 PM ET
        const today6pm = new Date(Date.UTC(y, mo, d, 18 + etOffset, 0, 0));
        return today6pm.toISOString();
      }
    }

    function nowISO() { return new Date().toISOString(); }

    async function getBars() {
      const allBars = await fetchBars(cid, sessionStartISO(), nowISO());
      // Drop the last bar (partial/still forming) — only use closed candles
      if (allBars.length > 1) allBars.pop();
      return allBars;
    }

    // Get contract info for tick size
    const contracts = await get('/market/contracts/available');
    const contract = contracts.contracts?.find(c => c.id === cid);
    if (!contract) { log('Contract not found: ' + cid); return; }
    const tickSize = contract.tickSize;

    // ── Drawing helpers ──
    const drawingIds = {};
    async function hline(key, price, label, color, ts) {
      if (drawingIds[key]) {
        try { await del(`/drawings/remove/${drawingIds[key]}`); } catch {}
      }
      const res = await post('/drawings/add', {
        type: 'hline', price, color, strokeWidth: 1, contractId: cid,
        text: makeText(label, color), startTime: ts || 0, extendLeft: !ts,
      });
      if (res.id) drawingIds[key] = res.id;
    }
    async function drawMarker(key, time, price, label, placement, color) {
      const res = await post('/drawings/add', {
        type: 'marker', time, price, color, label, placement,
        strokeWidth: 1, contractId: cid, text: null,
      });
      if (res.id) drawingIds[key] = res.id;
    }
    async function removeDrawing(key) {
      if (drawingIds[key]) {
        try { await del(`/drawings/remove/${drawingIds[key]}`); } catch {}
        delete drawingIds[key];
      }
    }

    // Draw current anchor levels on chart — detects SOS/SOW live
    async function drawAnchors(bars, low, high) {
      if (low) {
        const sosRaw = detectSOS(bars, low.index);
        const sosLabel = sosRaw.signOfStrength && !sosRaw.invalidated ? 'Move to Low (SOS)' : 'Move to Low';
        await hline('moveToLow', sosRaw.moveToLow, sosLabel, COLORS.moveToLow, bars[low.index].ts);
        await hline('slPreview', wickMidpoint(bars[low.index], 'long'), 'Stop Loss (preview)', COLORS.slPreview, bars[low.index].ts);
        if (sosRaw.importantTarget?.targetLevel) {
          await hline('prevSOS', sosRaw.importantTarget.targetLevel, 'Previous Move to Low (SOS)', COLORS.prevMoveToLow, sosRaw.importantTarget.prevLowBar.ts);
        }
      }
      if (high) {
        const sowRaw = detectSOW(bars, high.index);
        const sowLabel = sowRaw.signOfWeakness && !sowRaw.invalidated ? 'Move to High (SOW)' : 'Move to High';
        await hline('moveToHigh', sowRaw.moveToHigh, sowLabel, COLORS.moveToHigh, bars[high.index].ts);
        await hline('slPreviewShort', wickMidpoint(bars[high.index], 'short'), 'Stop Loss (preview)', COLORS.slPreview, bars[high.index].ts);
        if (sowRaw.importantTarget?.targetLevel) {
          await hline('prevSOW', sowRaw.importantTarget.targetLevel, 'Previous Move to High (SOW)', COLORS.prevMoveToHigh, sowRaw.importantTarget.prevHighBar.ts);
        }
      }
    }

    // Signal detection — shared between Phase 2 and Phase 3
    function checkForSignal(bars, low, high, side) {
      let sos = null, sow = null;
      let sosRaw = null, sowRaw = null;

      if ((side === 'long' || side === 'auto') && low) {
        sosRaw = detectSOS(bars, low.index);
        if (sosRaw.signOfStrength && !sosRaw.invalidated) sos = sosRaw;
      }
      if ((side === 'short' || side === 'auto') && high) {
        sowRaw = detectSOW(bars, high.index);
        if (sowRaw.signOfWeakness && !sowRaw.invalidated) sow = sowRaw;
      }

      if (side === 'auto') {
        if (sos && sow) {
          if (sos.signOfStrength.index >= sow.signOfWeakness.index) {
            log('Auto: SOS is more recent — going long');
            return { type: 'long', sos, bars };
          } else {
            // SOW is more recent, but check: is there a move to the low more recent than the SOW with no SOS?
            if (low && low.index > sow.signOfWeakness.index && !sos) {
              log('Auto: SOW detected but move to low is more recent with no SOS — waiting');
              return null;
            }
            log('Auto: SOW is more recent — going short');
            return { type: 'short', sow, bars };
          }
        } else if (sos) {
          // SOS exists, but check: is there a move to the high more recent than the SOS with no SOW?
          if (high && high.index > sos.signOfStrength.index && !sow) {
            log('Auto: SOS detected but move to high is more recent with no SOW — waiting');
            return null;
          }
          log('Auto: only SOS detected — going long');
          return { type: 'long', sos, bars };
        } else if (sow) {
          // SOW exists, but check: is there a move to the low more recent than the SOW with no SOS?
          if (low && low.index > sow.signOfWeakness.index) {
            log('Auto: SOW detected but move to low is more recent with no SOS — waiting');
            return null;
          }
          log('Auto: only SOW detected — going short');
          return { type: 'short', sow, bars };
        }
      } else if (side === 'long' && sos) {
        return { type: 'long', sos, bars };
      } else if (side === 'short' && sow) {
        return { type: 'short', sow, bars };
      }
      return null;
    }

    // ── Phase 1 & 2: Wait + Anchor window ──
    let low = null, high = null, bars = [];
    let earlySignal = null;

    await post('/drawings/clear-chart', {});

    if (startNow) {
      log(`Watch started NOW for ${cid} (${side}, size ${size}${manage ? ', manage' : ''}${dryRun ? ', dry-run' : ''})`);
      bars = await getBars();
      low = findAnchorLow(bars, 0);
      high = findAnchorHigh(bars, 0);

      // No fallback needed — sessionStartISO() fetches from last 6 PM ET

      log(`Anchors — Low: ${low ? fmt(low.bar.l) : '—'}, High: ${high ? fmt(high.bar.h) : '—'}`);
      await drawAnchors(bars, low, high);
    } else {
      // Phase 1: Wait for start time
      const [startH, startM] = startAt.split(':').map(Number);
      const startMinutes = startH * 60 + startM;

      if (nowETMinutes() < startMinutes) {
        const wait = startMinutes - nowETMinutes();
        log(`Waiting until ${startAt} AM ET... (${wait} minutes)`);
        while (nowETMinutes() < startMinutes) {
          await sleep(30_000);
        }
      }
      log(`Watch started for ${cid} (${side}, size ${size}${manage ? ', manage' : ''}${dryRun ? ', dry-run' : ''})`);

      // Phase 2: Anchor window — also checks for signals
      if (WINDOW_END > 0 && nowETMinutes() < WINDOW_END) {
        log(`Phase 2: Tracking anchors (until ${windowEndArg} ET)`);
        while (nowETMinutes() < WINDOW_END) {
          try {
            bars = await getBars();
            low = findAnchorLow(bars, 0);
            high = findAnchorHigh(bars, 0);
            if (low || high) {
              log(`Anchors — Low: ${low ? fmt(low.bar.l) : '—'}, High: ${high ? fmt(high.bar.h) : '—'}`);
              await drawAnchors(bars, low, high);

              // Check for signals during anchor window
              earlySignal = checkForSignal(bars, low, high, side);
              if (earlySignal) {
                log('Signal detected during anchor window — proceeding to order');
                break;
              }
            }
          } catch (e) { log('Fetch error: ' + e.message); }
          await sleepUntilNextCandle();
        }
      }

      if (!earlySignal) {
        // Final anchor fetch
        bars = await getBars();
        low = findAnchorLow(bars, 0);
        high = findAnchorHigh(bars, 0);
        log(`Anchors locked — Low: ${low ? fmt(low.bar.l) : '—'}, High: ${high ? fmt(high.bar.h) : '—'}`);
        await drawAnchors(bars, low, high);
      }
    }

    if (side === 'long' && !low) { log('No anchor low found. Exiting.'); return; }
    if (side === 'short' && !high) { log('No anchor high found. Exiting.'); return; }
    if (side === 'auto' && !low && !high) { log('No anchors found. Exiting.'); return; }

    // ── Phase 3: Wait for actionable signal ──
    let signal = earlySignal || null;
    // Futures: closed 5 PM ET Fri – 6 PM ET Sun. Open all other times.
    function isMarketClosed() {
      const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const day = etNow.getDay(); // 0=Sun, 5=Fri, 6=Sat
      const mins = etNow.getHours() * 60 + etNow.getMinutes();
      if (day === 6) return true; // Saturday — always closed
      if (day === 5 && mins >= 17 * 60) return true; // Friday after 5 PM
      if (day === 0 && mins < 18 * 60) return true; // Sunday before 6 PM
      return false;
    }
    let entryPrice, slPrice, tpPrice, importantTarget;

    if (!signal) {
      log('Phase 3: Waiting for signal' + (side === 'auto' ? ' (auto — most recent wins)' : ''));
      // Draw anchors immediately before entering the loop
      await drawAnchors(bars, low, high);
    }

    // Outer loop: find signal, check target, retry if already hit
    let actionable = false;
    let lastSkippedSignal = null;
    while (!actionable) {
      // Inner loop: wait for a signal
      while (!signal) {
        if (isMarketClosed()) { log('Market closed, no signal. Exiting.'); return; }
        try {
          bars = await getBars();
          low = findAnchorLow(bars, 0);
          high = findAnchorHigh(bars, 0);
          await drawAnchors(bars, low, high);
          signal = checkForSignal(bars, low, high, side);
        } catch (e) { log('Fetch error: ' + e.message); }
        if (!signal) await sleepUntilNextCandle();
      }

      // Re-draw with signal labels
      await drawAnchors(bars, low, high);

      // Compute order params
      if (signal.type === 'long') {
        const sos = signal.sos;
        entryPrice = sos.invalidation.level;
        slPrice = wickMidpoint(sos.lowBar, 'long');
        importantTarget = sos.importantTarget;
        tpPrice = importantTarget?.targetLevel;
        log(`SOS detected — entry: ${fmt(entryPrice)}, SL: ${fmt(slPrice)}, TP: ${fmt(tpPrice)}`);
      } else {
        const sow = signal.sow;
        entryPrice = sow.invalidation.level;
        slPrice = wickMidpoint(sow.highBar, 'short');
        importantTarget = sow.importantTarget;
        tpPrice = importantTarget?.targetLevel;
        log(`SOW detected — entry: ${fmt(entryPrice)}, SL: ${fmt(slPrice)}, TP: ${fmt(tpPrice)}`);
      }

      // Check if target was already hit — only skip if invalidation was also tested
      if (tpPrice) {
        const signalIndex = signal.type === 'long' ? signal.sos.signOfStrength.index : signal.sow.signOfWeakness.index;
        let targetAlreadyHit = false;
        let invalidationTested = false;
        const invLevel = signal.type === 'long' ? signal.sos.invalidation?.level : signal.sow.invalidation?.level;
        for (let i = signalIndex + 1; i < bars.length; i++) {
          if (signal.type === 'long') {
            if (invLevel && bars[i].l <= invLevel) invalidationTested = true;
            if (bars[i].h >= tpPrice) targetAlreadyHit = true;
          }
          if (signal.type === 'short') {
            if (invLevel && bars[i].h >= invLevel) invalidationTested = true;
            if (bars[i].l <= tpPrice) targetAlreadyHit = true;
          }
          if (targetAlreadyHit && invalidationTested) break;
        }
        if (targetAlreadyHit && invalidationTested) {
          const skipKey = `${signal.type}-${entryPrice}-${tpPrice}`;
          if (skipKey !== lastSkippedSignal) {
            log('Target already hit and invalidation tested — skipping, continuing to watch...');
            lastSkippedSignal = skipKey;
          }
          signal = null;
          await sleepUntilNextCandle();
          continue;
        }
        if (targetAlreadyHit && !invalidationTested) {
          log('Target hit but invalidation not tested — order still valid');
        }
      }

      actionable = true;
    }

    const slTicks = Math.round(Math.abs(entryPrice - slPrice) / tickSize);
    const tpTicks = tpPrice ? Math.round(Math.abs(tpPrice - entryPrice) / tickSize) : 0;

    // ── Phase 4: Place order ──
    log(`Phase 4: Placing ${signal.type === 'long' ? 'limit buy' : 'limit sell'} @ ${fmt(entryPrice)}, SL: ${slTicks} ticks, TP: ${tpTicks} ticks`);

    // Update drawings for order placement
    if (signal.type === 'long') {
      const sos = signal.sos;
      await hline('moveToLow', sos.moveToLow, 'Move to Low (SOS)', COLORS.moveToLow, sos.lowBar.ts);
      await hline('slPreview', slPrice, 'Stop Loss (preview)', COLORS.slPreview, sos.lowBar.ts);
      if (tpPrice && importantTarget) await hline('prevSOS', tpPrice, 'Previous Move to Low (SOS)', COLORS.prevMoveToLow, importantTarget.prevLowBar.ts);
    } else {
      const sow = signal.sow;
      await hline('moveToHigh', sow.moveToHigh, 'Move to High (SOW)', COLORS.moveToHigh, sow.highBar.ts);
      await hline('slPreview', slPrice, 'Stop Loss (preview)', COLORS.slPreview, sow.highBar.ts);
      if (tpPrice && importantTarget) await hline('prevSOW', tpPrice, 'Previous Move to High (SOW)', COLORS.prevMoveToHigh, importantTarget.prevHighBar.ts);
    }

    if (!dryRun) {
      const orderBody = {
        accountId: acct,
        contractId: cid,
        type: 'limit',
        side: signal.type === 'long' ? 'buy' : 'sell',
        size,
        limitPrice: entryPrice,
        slTicks,
      };
      if (tpTicks > 0) orderBody.tpTicks = tpTicks;
      const result = await post('/drawings/place-order', orderBody);
      log('Order placed: ' + JSON.stringify(result));
    } else {
      log('(dry-run) Order skipped');
    }

    // ── Wait for fill, then add entry marker and remove SL preview ──
    log('Waiting for fill...');
    let filled = false;
    while (!filled) {
      if (isMarketClosed()) { log('Market closed before fill. Exiting.'); return; }
      try {
        // Check if filled
        const posResult = await get(`/positions/open?accountId=${acct}`);
        const pos = posResult.positions?.find(p => String(p.contractId) === String(cid) && p.size > 0);
        if (pos) {
          filled = true;
          log(`Filled! Position: ${pos.size} @ ${fmt(pos.averagePrice)}`);
          const nowBars = await getBars();
          const lastBar = nowBars[nowBars.length - 1];
          const placement = signal.type === 'long' ? 'below' : 'above';
          const label = signal.type === 'long'
            ? `Long Entry ${size} @ ${fmt(entryPrice)}`
            : `Short Entry ${size} @ ${fmt(entryPrice)}`;
          await drawMarker('entry', lastBar.ts, entryPrice, label, placement, signal.type === 'long' ? COLORS.moveToLow : COLORS.moveToHigh);
          await removeDrawing('slPreview');
          break;
        }

        // Check if target was hit before fill — cancel the order
        if (tpPrice) {
          const nowBars = await getBars();
          const lastBar = nowBars[nowBars.length - 1];
          const targetHit = signal.type === 'long' ? lastBar.h >= tpPrice : lastBar.l <= tpPrice;
          if (targetHit) {
            log('Target hit before fill — cancelling order...');
            const ordResult = await get(`/orders/open?accountId=${acct}`);
            const pendingOrder = ordResult.orders?.find(o =>
              String(o.contractId) === String(cid) && o.status === 1
              && o.limitPrice === entryPrice
            );
            if (pendingOrder) {
              await post('/orders/cancel', { accountId: acct, orderId: String(pendingOrder.id) });
              log('Order cancelled. Continuing to watch...');
            }
            break;
          }
        }
      } catch (e) { log('Fill check error: ' + e.message); }
      if (!filled) await sleep(10_000);
    }

    if (!filled) {
      // Target was hit before fill — go back to watching
      signal = null;
      // TODO: could loop back to Phase 3, for now just keep scanning
      log('Resuming watch after order cancellation...');
      while (true) {
        if (isMarketClosed()) { log('Market closed. Exiting.'); return; }
        try {
          bars = await getBars();
          low = findAnchorLow(bars, 0);
          high = findAnchorHigh(bars, 0);
          await drawAnchors(bars, low, high);
        } catch (e) { log('Fetch error: ' + e.message); }
        await sleepUntilNextCandle();
      }
    }

    if (!manage) { log('Done (no --manage). Watch complete.'); return; }

    // ── Phase 5: Trade management ──
    log('Phase 5: Managing trade (SL trailing)');
    let lastTrailCount = 0;
    let slOrderId = null;

    while (true) {
      if (isMarketClosed()) { log('Market closed. Exiting management.'); break; }

      try {
        // Check position
        const posResult = await get(`/positions/open?accountId=${acct}`);
        const pos = posResult.positions?.find(p => String(p.contractId) === String(cid) && p.size > 0);
        if (!pos) { log('Position closed (SL or TP hit). Done.'); break; }

        // Discover SL order
        if (!slOrderId) {
          const ordResult = await get(`/orders/open?accountId=${acct}`);
          const oppSide = signal.type === 'long' ? 1 : 0; // opposite side
          const slOrder = ordResult.orders?.find(o =>
            String(o.contractId) === String(cid) && o.type === 4 && o.side === oppSide
          );
          if (slOrder) slOrderId = slOrder.id;
        }

        // Re-fetch bars and run management
        bars = await getBars();
        low = findAnchorLow(bars, 0);
        high = findAnchorHigh(bars, 0);

        let events = [];
        if (signal.type === 'long' && low) {
          const sos = detectSOS(bars, low.index);
          if (sos.signOfStrength) events = scanTradeManagement(bars, sos.signOfStrength.index, 'long');
        } else if (signal.type === 'short' && high) {
          const sow = detectSOW(bars, high.index);
          if (sow.signOfWeakness) events = scanTradeManagement(bars, sow.signOfWeakness.index, 'short');
        }

        if (events.length > lastTrailCount) {
          const latest = events[events.length - 1];
          log(`SL trail #${events.length}: new SL = ${fmt(latest.newSL)}`);

          if (slOrderId && !dryRun) {
            await patch('/orders/modify', { accountId: acct, orderId: String(slOrderId), stopPrice: latest.newSL });
            log('SL order modified');
          }
          lastTrailCount = events.length;
        }
      } catch (e) { log('Management error: ' + e.message); }

      await sleepUntilNextCandle();
    }

    log('Watch complete.');
  },
};

// ── Main ──

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || !commands[cmd]) {
  console.log('Commands: ' + Object.keys(commands).join(', '));
  process.exit(cmd ? 1 : 0);
}

commands[cmd](parseArgs(rest)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
