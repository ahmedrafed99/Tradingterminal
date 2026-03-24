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
  support: '#5b8a72',
  resistance: '#a65d6a',
  neutral: '#787b86',
  tp: '#b8a04a',
  sl: '#8b5c5c',
  info: '#6b7ea0',
};

function makeText(content, color) {
  return {
    content,
    color,
    fontSize: 12,
    bold: false,
    italic: false,
    hAlign: 'left',
    vAlign: 'middle',
  };
}

// ── Commands ──

const commands = {
  async 'draw-hline'(args) {
    require(args, 'price');
    const color = args.color || COLORS.neutral;
    const result = await post('/drawings/add', {
      type: 'hline',
      price: Number(args.price),
      color,
      strokeWidth: Number(args.strokeWidth || 1),
      contractId: args.contractId || '',
      text: args.label ? makeText(args.label, color) : null,
      startTime: 0,
      extendLeft: true,
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
      unit: Number(args.unit || 2),
      unitNumber: Number(args.unitNumber || 1),
      startTime: args.from,
      endTime: args.to,
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
    const s = await loadSession(args.contractId, args.date);

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
    }
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
