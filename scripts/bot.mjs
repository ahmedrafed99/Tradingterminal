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
    // OrderType: Limit=1, Market=2, Stop=4, TrailingStop=5
    const typeMap = { market: 2, limit: 1, stop: 4 };
    const sideMap = { buy: 0, sell: 1 };
    const orderType = typeMap[args.type.toLowerCase()];
    const orderSide = sideMap[args.side.toLowerCase()];
    if (orderType === undefined) die(`invalid --type: ${args.type} (market|limit|stop)`);
    if (orderSide === undefined) die(`invalid --side: ${args.side} (buy|sell)`);

    const isBuy = orderSide === 0;
    const body = {
      accountId: args.accountId,
      contractId: args.contractId,
      type: orderType,
      side: orderSide,
      size: Number(args.size),
    };
    if (args.price) body.limitPrice = Number(args.price);
    if (args.stopPrice) body.stopPrice = Number(args.stopPrice);
    // Ticks are signed: buy SL negative (below), buy TP positive (above); reversed for sell
    if (args.sl) body.stopLossBracket = { ticks: Number(args.sl) * (isBuy ? -1 : 1), type: 4 };
    if (args.tp) body.takeProfitBracket = { ticks: Number(args.tp) * (isBuy ? 1 : -1), type: 1 };

    const result = await post('/orders/place', body);
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
