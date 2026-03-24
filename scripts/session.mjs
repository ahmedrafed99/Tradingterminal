/**
 * Session structure analysis — detects all concepts from docs/bot-trading/concepts.md
 *
 * Usage:
 *   import { loadSession } from './session.mjs';
 *   const s = await loadSession(contractId, '2026-03-24');
 *   console.log(s.sos.moveToLow, s.sos.signOfStrength, s.sos.target);
 */

const BASE = process.env.BOT_API_URL || 'http://localhost:3001';

// ── Bar fetching ──

async function fetchBars(contractId, from, to) {
  const res = await fetch(`${BASE}/market/bars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId,
      unit: 2,        // minute bars
      unitNumber: 1,   // 1-minute
      startTime: from,
      endTime: to,
    }),
  });
  const data = await res.json();
  if (!data.bars?.length) return [];
  return data.bars
    .map((b) => ({
      t: b.t,
      ts: Math.floor(new Date(b.t).getTime() / 1000),
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
    }))
    .sort((a, b) => a.ts - b.ts);
}

// ── Time helpers ──

function toET(isoString) {
  return new Date(isoString).toLocaleString('en-US', { timeZone: 'America/New_York' });
}

function etHourMin(bar) {
  const et = new Date(toET(bar.t));
  return et.getHours() * 60 + et.getMinutes();
}

// ── Core detection ──

function findAnchorLow(bars) {
  // Lowest price in 7:30–9:20 AM ET window
  const start = 7 * 60 + 30;  // 450
  const end = 9 * 60 + 20;    // 560
  const window = bars.filter((b) => {
    const m = etHourMin(b);
    return m >= start && m <= end;
  });
  if (window.length === 0) return null;

  let lowest = window[0];
  let lowestIdx = bars.indexOf(window[0]);
  for (const b of window) {
    if (b.l < lowest.l) {
      lowest = b;
      lowestIdx = bars.indexOf(b);
    }
  }
  return { bar: lowest, index: lowestIdx };
}

function findAnchorHigh(bars) {
  // Highest price in 7:30–9:20 AM ET window
  const start = 7 * 60 + 30;
  const end = 9 * 60 + 20;
  const window = bars.filter((b) => {
    const m = etHourMin(b);
    return m >= start && m <= end;
  });
  if (window.length === 0) return null;

  let highest = window[0];
  let highestIdx = bars.indexOf(window[0]);
  for (const b of window) {
    if (b.h > highest.h) {
      highest = b;
      highestIdx = bars.indexOf(b);
    }
  }
  return { bar: highest, index: highestIdx };
}

// ── SOS detection ──

function detectSOS(bars, lowIndex) {
  const lowBar = bars[lowIndex];
  const moveToLow = lowBar.h;

  // Swing to the low — high of candle before the low
  const swingToLow = lowIndex > 0 ? bars[lowIndex - 1].h : null;

  // Sign of strength — first candle closing above move to the low
  let signOfStrength = null;
  for (let i = lowIndex + 1; i < bars.length; i++) {
    if (bars[i].c > moveToLow) {
      signOfStrength = { level: moveToLow, bar: bars[i], index: i };
      break;
    }
  }

  // Invalidation of strength — low of the SOS confirmation candle
  let invalidation = null;
  if (signOfStrength) {
    invalidation = {
      level: signOfStrength.bar.l,
      bar: signOfStrength.bar,
      index: signOfStrength.index,
    };
  }

  // Invalidation confirmed — candle closing below the invalidation level
  let invalidated = null;
  if (invalidation) {
    for (let i = invalidation.index + 1; i < bars.length; i++) {
      if (bars[i].c < invalidation.level) {
        invalidated = { bar: bars[i], index: i };
        break;
      }
    }
  }

  // Previous sign of strength (target)
  const target = findPreviousSOS(bars, lowIndex, moveToLow);

  return {
    lowBar,
    lowIndex,
    moveToLow,
    swingToLow,
    signOfStrength,
    invalidation,
    invalidated,
    target,
  };
}

function findPreviousSOS(bars, lowIndex, moveToLowLevel) {
  // Step 1-3: scan backwards, skip candles with low < level, stop at first with low > level
  let escapeIndex = null;
  for (let i = lowIndex - 1; i >= 0; i--) {
    if (bars[i].l > moveToLowLevel) {
      escapeIndex = i;
      break;
    }
  }
  if (escapeIndex === null) return null;

  // Step 4: from escape, scan backwards for first UP candle
  let firstUp = null;
  for (let i = escapeIndex; i >= 0; i--) {
    if (bars[i].c > bars[i].o) {
      firstUp = { bar: bars[i], index: i };
      break;
    }
  }
  if (!firstUp) return null;

  // Step 5: scan backwards for another UP candle that is higher
  let secondUp = null;
  for (let i = firstUp.index - 1; i >= 0; i--) {
    if (bars[i].c > bars[i].o && bars[i].h > firstUp.bar.h) {
      secondUp = { bar: bars[i], index: i };
      break;
    }
  }
  if (!secondUp) return null;

  // Step 6: lowest point between the two UP candles
  const from = secondUp.index;
  const to = firstUp.index;
  let prevLow = bars[from];
  let prevLowIdx = from;
  for (let i = from; i <= to; i++) {
    if (bars[i].l < prevLow.l) {
      prevLow = bars[i];
      prevLowIdx = i;
    }
  }

  // Apply standard SOS: move to the low = high of prev low candle
  const prevMoveToLow = prevLow.h;

  // Find sign of strength for previous structure
  let prevSOS = null;
  for (let i = prevLowIdx + 1; i < bars.length; i++) {
    if (bars[i].c > prevMoveToLow) {
      prevSOS = { level: prevMoveToLow, bar: bars[i], index: i };
      break;
    }
  }

  return {
    prevLowBar: prevLow,
    prevLowIndex: prevLowIdx,
    prevMoveToLow,
    signOfStrength: prevSOS,
    targetLevel: prevSOS ? prevMoveToLow : null,
  };
}

// ── SOW detection ──

function detectSOW(bars, highIndex) {
  const highBar = bars[highIndex];
  const moveToHigh = highBar.l;

  // Swing to the high — low of candle before the high
  const swingToHigh = highIndex > 0 ? bars[highIndex - 1].l : null;

  // Sign of weakness — first candle closing below move to the high
  let signOfWeakness = null;
  for (let i = highIndex + 1; i < bars.length; i++) {
    if (bars[i].c < moveToHigh) {
      signOfWeakness = { level: moveToHigh, bar: bars[i], index: i };
      break;
    }
  }

  // Invalidation of weakness — high of the SOW confirmation candle
  let invalidation = null;
  if (signOfWeakness) {
    invalidation = {
      level: signOfWeakness.bar.h,
      bar: signOfWeakness.bar,
      index: signOfWeakness.index,
    };
  }

  // Invalidation confirmed — candle closing above the invalidation level
  let invalidated = null;
  if (invalidation) {
    for (let i = invalidation.index + 1; i < bars.length; i++) {
      if (bars[i].c > invalidation.level) {
        invalidated = { bar: bars[i], index: i };
        break;
      }
    }
  }

  // Previous sign of weakness (target)
  const target = findPreviousSOW(bars, highIndex, moveToHigh);

  return {
    highBar,
    highIndex,
    moveToHigh,
    swingToHigh,
    signOfWeakness,
    invalidation,
    invalidated,
    target,
  };
}

function findPreviousSOW(bars, highIndex, moveToHighLevel) {
  // Step 1-3: scan backwards, skip candles with high > level, stop at first with high < level
  let escapeIndex = null;
  for (let i = highIndex - 1; i >= 0; i--) {
    if (bars[i].h < moveToHighLevel) {
      escapeIndex = i;
      break;
    }
  }
  if (escapeIndex === null) return null;

  // Step 4: from escape, scan backwards for first DOWN candle
  let firstDown = null;
  for (let i = escapeIndex; i >= 0; i--) {
    if (bars[i].c < bars[i].o) {
      firstDown = { bar: bars[i], index: i };
      break;
    }
  }
  if (!firstDown) return null;

  // Step 5: scan backwards for another DOWN candle that is lower
  let secondDown = null;
  for (let i = firstDown.index - 1; i >= 0; i--) {
    if (bars[i].c < bars[i].o && bars[i].l < firstDown.bar.l) {
      secondDown = { bar: bars[i], index: i };
      break;
    }
  }
  if (!secondDown) return null;

  // Step 6: highest point between the two DOWN candles
  const from = secondDown.index;
  const to = firstDown.index;
  let prevHigh = bars[from];
  let prevHighIdx = from;
  for (let i = from; i <= to; i++) {
    if (bars[i].h > prevHigh.h) {
      prevHigh = bars[i];
      prevHighIdx = i;
    }
  }

  // Apply standard SOW: move to the high = low of prev high candle
  const prevMoveToHigh = prevHigh.l;

  // Find sign of weakness for previous structure
  let prevSOW = null;
  for (let i = prevHighIdx + 1; i < bars.length; i++) {
    if (bars[i].c < prevMoveToHigh) {
      prevSOW = { level: prevMoveToHigh, bar: bars[i], index: i };
      break;
    }
  }

  return {
    prevHighBar: prevHigh,
    prevHighIndex: prevHighIdx,
    prevMoveToHigh,
    signOfWeakness: prevSOW,
    targetLevel: prevSOW ? prevMoveToHigh : null,
  };
}

// ── Public API ──

export async function loadSession(contractId, date) {
  // Fetch bars from 4:00 AM to 11:00 PM ET to have enough history for backwards scanning
  const d = new Date(date + 'T00:00:00Z');
  const from = new Date(d); from.setUTCHours(8, 0, 0, 0);   // 4 AM ET (UTC-4)
  const to = new Date(d); to.setUTCHours(27, 0, 0, 0);      // 11 PM ET

  const bars = await fetchBars(contractId, from.toISOString(), to.toISOString());
  if (bars.length === 0) return { bars: [], low: null, high: null, sos: null, sow: null };

  const low = findAnchorLow(bars);
  const high = findAnchorHigh(bars);

  const sos = low ? detectSOS(bars, low.index) : null;
  const sow = high ? detectSOW(bars, high.index) : null;

  return { bars, low, high, sos, sow };
}
