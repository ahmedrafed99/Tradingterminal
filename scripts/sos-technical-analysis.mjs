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

export async function fetchBars(contractId, from, to) {
  const res = await fetch(`${BASE}/market/bars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractId,
      live: false,
      unit: 2,        // minute bars
      unitNumber: 1,   // 1-minute
      startTime: from,
      endTime: to,
      limit: 20000,
      includePartialBar: true,
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

export function etHourMin(bar) {
  const et = new Date(toET(bar.t));
  return et.getHours() * 60 + et.getMinutes();
}

// ── Core detection ──

export function findAnchorLow(bars, startMinute = 450, endMinute = null) {
  // Lowest price from startMinute (default 7:30=450) onwards. Pass endMinute to cap.
  const window = bars.filter((b) => {
    const m = etHourMin(b);
    return m >= startMinute && (endMinute === null || m <= endMinute);
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

export function findAnchorHigh(bars, startMinute = 450, endMinute = null) {
  // Highest price from startMinute (default 7:30=450) onwards. Pass endMinute to cap.
  const window = bars.filter((b) => {
    const m = etHourMin(b);
    return m >= startMinute && (endMinute === null || m <= endMinute);
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

export function detectSOS(bars, lowIndex) {
  const lowBar = bars[lowIndex];
  const moveToLow = lowBar.h;

  // Swing to the low — high of candle before the low
  const swingToLow = lowIndex > 0 ? bars[lowIndex - 1].h : null;

  // Sign of strength — scan forward, track latest SOS and invalidation state
  // If invalidated, look for re-confirmation (new candle closing above move to low)
  let signOfStrength = null;
  let invalidation = null;
  let invalidated = null;

  for (let i = lowIndex + 1; i < bars.length; i++) {
    if (!signOfStrength || invalidated) {
      // Looking for (re-)confirmation: candle closing above move to low
      if (bars[i].c > moveToLow) {
        signOfStrength = { level: moveToLow, bar: bars[i], index: i };
        invalidation = { level: bars[i].l, bar: bars[i], index: i };
        invalidated = null; // reset invalidation
      }
    } else if (invalidation && !invalidated) {
      // SOS is active — check for invalidation: candle closing below invalidation level
      if (bars[i].c < invalidation.level) {
        invalidated = { bar: bars[i], index: i };
      }
    }
  }

  // Previous sign of strength (target)
  const target = findPreviousSOS(bars, lowIndex, moveToLow);
  const importantTarget = findImportantPreviousSOS(bars, lowIndex, moveToLow);

  return {
    lowBar,
    lowIndex,
    moveToLow,
    swingToLow,
    signOfStrength,
    invalidation,
    invalidated,
    target,
    importantTarget,
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

function findImportantPreviousSOS(bars, lowIndex, moveToLowLevel) {
  // Step 1: find escape candle
  let escapeIndex = null;
  for (let i = lowIndex - 1; i >= 0; i--) {
    if (bars[i].l > moveToLowLevel) {
      escapeIndex = i;
      break;
    }
  }
  if (escapeIndex === null) return null;

  // Step 2a: scan backwards from escape, find a candle whose high was gained (SOS)
  // AND after that gain there was a SOW (confirmed by highest point's move-to-high being lost)
  let prevSOSCandle = null; // the candle whose high was gained
  let prevSOSIndex = null;  // index of the candle that closed above (the SOS confirmation)

  for (let i = escapeIndex; i >= 0; i--) {
    const candidateHigh = bars[i].h;

    // Check if this high was gained: a later candle closed above it, before lowIndex
    let gainIndex = null;
    for (let j = i + 1; j < lowIndex; j++) {
      if (bars[j].c > candidateHigh) {
        gainIndex = j;
        break;
      }
    }
    if (gainIndex === null) continue;

    // Found a gain — now check for SOW in the range [i .. lowIndex)
    // Find highest point in range [gainIndex .. lowIndex)
    let highestBar = bars[gainIndex];
    for (let j = gainIndex; j < lowIndex; j++) {
      if (bars[j].h > highestBar.h) highestBar = bars[j];
    }
    const moveToHigh = highestBar.l;

    // Check if any candle closed below moveToHigh (SOW) after the highest, before lowIndex
    let sowFound = false;
    const highestIdx = bars.indexOf(highestBar);
    for (let j = highestIdx + 1; j < lowIndex; j++) {
      if (bars[j].c < moveToHigh) { sowFound = true; break; }
    }

    if (sowFound) {
      prevSOSCandle = bars[i];
      prevSOSIndex = gainIndex;
      break;
    }
  }

  if (!prevSOSCandle) return null;

  // Step 2b: scan backwards from escape for candle whose low is closest to moveToLowLevel
  // from above (low >= moveToLowLevel), AND older than the previous SOS candle
  const prevSOSCandleIdx = bars.indexOf(prevSOSCandle);
  let closestBar = null;
  let closestIdx = -1;
  let closestDiff = Infinity;

  for (let i = escapeIndex; i >= 0; i--) {
    if (i >= prevSOSCandleIdx) continue; // must be older than the prev SOS candle
    if (bars[i].l >= moveToLowLevel) {
      const diff = bars[i].l - moveToLowLevel;
      if (diff < closestDiff) {
        closestDiff = diff;
        closestBar = bars[i];
        closestIdx = i;
      }
    }
  }

  if (!closestBar) return null;

  // Find highest point between closestBar and the previous SOS confirmation
  let highestBar = closestBar;
  let highestIdx = closestIdx;
  for (let i = closestIdx; i <= prevSOSIndex; i++) {
    if (bars[i].h > highestBar.h) {
      highestBar = bars[i];
      highestIdx = i;
    }
  }

  // Narrow range: from closestBar (inclusive) to highest point (exclusive)
  let trendLow = closestBar;
  let trendLowIdx = closestIdx;
  for (let i = closestIdx; i < highestIdx; i++) {
    if (bars[i].l < trendLow.l) {
      trendLow = bars[i];
      trendLowIdx = i;
    }
  }

  // Step 2c: this is the previous trend's low. Its high = previous trend's move to low.
  const prevTrendMTL = trendLow.h;

  // Find SOS on this: first candle closing above prevTrendMTL, up to and including the prev SOS gain
  let targetSOS = null;
  for (let i = trendLowIdx + 1; i <= prevSOSIndex; i++) {
    if (bars[i].c > prevTrendMTL) {
      targetSOS = { level: prevTrendMTL, bar: bars[i], index: i };
      break;
    }
  }

  if (!targetSOS) return null;

  return {
    prevLowBar: trendLow,
    prevLowIndex: trendLowIdx,
    prevMoveToLow: prevTrendMTL,
    signOfStrength: targetSOS,
    targetLevel: prevTrendMTL,
  };
}

// ── SOW detection ──

export function detectSOW(bars, highIndex) {
  const highBar = bars[highIndex];
  const moveToHigh = highBar.l;

  // Swing to the high — low of candle before the high
  const swingToHigh = highIndex > 0 ? bars[highIndex - 1].l : null;

  // Sign of weakness — scan forward, track latest SOW and invalidation state
  // If invalidated, look for re-confirmation (new candle closing below move to high)
  let signOfWeakness = null;
  let invalidation = null;
  let invalidated = null;

  for (let i = highIndex + 1; i < bars.length; i++) {
    if (!signOfWeakness || invalidated) {
      // Looking for (re-)confirmation: candle closing below move to high
      if (bars[i].c < moveToHigh) {
        signOfWeakness = { level: moveToHigh, bar: bars[i], index: i };
        invalidation = { level: bars[i].h, bar: bars[i], index: i };
        invalidated = null; // reset invalidation
      }
    } else if (invalidation && !invalidated) {
      // SOW is active — check for invalidation: candle closing above invalidation level
      if (bars[i].c > invalidation.level) {
        invalidated = { bar: bars[i], index: i };
      }
    }
  }

  // Previous sign of weakness (target)
  const target = findPreviousSOW(bars, highIndex, moveToHigh);
  const importantTarget = findImportantPreviousSOW(bars, highIndex, moveToHigh);

  return {
    highBar,
    highIndex,
    moveToHigh,
    swingToHigh,
    signOfWeakness,
    invalidation,
    invalidated,
    target,
    importantTarget,
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

function findImportantPreviousSOW(bars, highIndex, moveToHighLevel) {
  // Step 1: find escape candle
  let escapeIndex = null;
  for (let i = highIndex - 1; i >= 0; i--) {
    if (bars[i].h < moveToHighLevel) {
      escapeIndex = i;
      break;
    }
  }
  if (escapeIndex === null) return null;

  // Step 2a: scan backwards from escape, find a candle whose low was gained (SOW)
  // AND after that gain there was a SOS (confirmed by lowest point's move-to-low being gained)
  let prevSOWCandle = null;
  let prevSOWIndex = null;

  for (let i = escapeIndex; i >= 0; i--) {
    const candidateLow = bars[i].l;

    // Check if this low was gained: a later candle closed below it, before highIndex
    let gainIndex = null;
    for (let j = i + 1; j < highIndex; j++) {
      if (bars[j].c < candidateLow) {
        gainIndex = j;
        break;
      }
    }
    if (gainIndex === null) continue;

    // Found a gain — now check for SOS in the range [gainIndex .. highIndex)
    // Find lowest point in range
    let lowestBar = bars[gainIndex];
    for (let j = gainIndex; j < highIndex; j++) {
      if (bars[j].l < lowestBar.l) lowestBar = bars[j];
    }
    const moveToLow = lowestBar.h;

    // Check if any candle closed above moveToLow (SOS) after the lowest, before highIndex
    let sosFound = false;
    const lowestIdx = bars.indexOf(lowestBar);
    for (let j = lowestIdx + 1; j < highIndex; j++) {
      if (bars[j].c > moveToLow) { sosFound = true; break; }
    }

    if (sosFound) {
      prevSOWCandle = bars[i];
      prevSOWIndex = gainIndex;
      break;
    }
  }

  if (!prevSOWCandle) return null;

  // Step 2b: scan backwards from escape for candle whose high is closest to moveToHighLevel
  // from below (high <= moveToHighLevel), AND older than the previous SOW candle
  const prevSOWCandleIdx = bars.indexOf(prevSOWCandle);
  let closestBar = null;
  let closestIdx = -1;
  let closestDiff = Infinity;

  for (let i = escapeIndex; i >= 0; i--) {
    if (i >= prevSOWCandleIdx) continue;
    if (bars[i].h <= moveToHighLevel) {
      const diff = moveToHighLevel - bars[i].h;
      if (diff < closestDiff) {
        closestDiff = diff;
        closestBar = bars[i];
        closestIdx = i;
      }
    }
  }

  if (!closestBar) return null;

  // Find lowest point between closestBar and the previous SOW confirmation
  let lowestBar = closestBar;
  let lowestIdx = closestIdx;
  for (let i = closestIdx; i <= prevSOWIndex; i++) {
    if (bars[i].l < lowestBar.l) {
      lowestBar = bars[i];
      lowestIdx = i;
    }
  }

  // Narrow range: from closestBar (inclusive) to lowest point (exclusive)
  let trendHigh = closestBar;
  let trendHighIdx = closestIdx;
  for (let i = closestIdx; i < lowestIdx; i++) {
    if (bars[i].h > trendHigh.h) {
      trendHigh = bars[i];
      trendHighIdx = i;
    }
  }

  // Step 2c: this is the previous trend's high. Its low = previous trend's move to high.
  const prevTrendMTH = trendHigh.l;

  // Find SOW on this: first candle closing below prevTrendMTH, up to and including the prev SOW gain
  let targetSOW = null;
  for (let i = trendHighIdx + 1; i <= prevSOWIndex; i++) {
    if (bars[i].c < prevTrendMTH) {
      targetSOW = { level: prevTrendMTH, bar: bars[i], index: i };
      break;
    }
  }

  if (!targetSOW) return null;

  return {
    prevHighBar: trendHigh,
    prevHighIndex: trendHighIdx,
    prevMoveToHigh: prevTrendMTH,
    signOfWeakness: targetSOW,
    targetLevel: prevTrendMTH,
  };
}

// ── Trade Management ──

/**
 * Midpoint of the lower wick (long SL) or upper wick (short SL).
 */
export function wickMidpoint(bar, side) {
  if (side === 'long') {
    const lowerBody = Math.min(bar.o, bar.c);
    return bar.l + (lowerBody - bar.l) / 2;
  } else {
    const upperBody = Math.max(bar.o, bar.c);
    return bar.h - (bar.h - upperBody) / 2;
  }
}

/**
 * Scan forward from startIndex for SL trail events.
 * For longs: watch for sign of weakness (candle closing below running move-to-high).
 * For shorts: watch for sign of strength (candle closing above running move-to-low).
 *
 * Returns an array of trail events:
 *   { newSL, sowBar, sowIndex, recoveryBar, recoveryIndex, lowestBar, lowestIndex }
 */
export function scanTradeManagement(bars, startIndex, side) {
  if (side === 'long') return scanLongManagement(bars, startIndex);
  return scanShortManagement(bars, startIndex);
}

function scanLongManagement(bars, startIndex) {
  const events = [];
  let runningHighBar = bars[startIndex];
  let currentSL = -Infinity; // SL only moves up for longs
  let i = startIndex;

  while (i < bars.length) {
    // Update running high
    if (bars[i].h > runningHighBar.h) {
      runningHighBar = bars[i];
    }

    const moveToHigh = runningHighBar.l;

    // Detect sign of weakness: candle closing below move to high
    if (bars[i].c < moveToHigh) {
      const sowBar = bars[i];
      const sowIndex = i;
      const invalidationLevel = sowBar.h; // high of SOW candle

      // Check very next candle
      if (i + 1 >= bars.length) break;
      const nextBar = bars[i + 1];

      if (nextBar.c > invalidationLevel) {
        // Immediate recovery — dismiss, continue from next candle
        i = i + 2;
        continue;
      }

      // No immediate recovery — scan forward until recovery
      let recoveryIndex = null;
      for (let j = i + 2; j < bars.length; j++) {
        if (bars[j].c > invalidationLevel) {
          recoveryIndex = j;
          break;
        }
      }

      if (recoveryIndex === null) {
        // No recovery found in available data
        break;
      }

      // Find lowest point between SOW candle and recovery candle
      let lowestBar = bars[sowIndex];
      let lowestIndex = sowIndex;
      for (let j = sowIndex; j <= recoveryIndex; j++) {
        if (bars[j].l < lowestBar.l) {
          lowestBar = bars[j];
          lowestIndex = j;
        }
      }

      const newSL = wickMidpoint(lowestBar, 'long');

      // SL only moves up for longs — skip if new SL is lower than current
      if (newSL > currentSL) {
        currentSL = newSL;
        events.push({
          newSL,
          sowBar,
          sowIndex,
          recoveryBar: bars[recoveryIndex],
          recoveryIndex,
          lowestBar,
          lowestIndex,
        });
      }

      // Continue scanning from recovery candle, update running high
      i = recoveryIndex;
      runningHighBar = bars[recoveryIndex];
      continue;
    }

    i++;
  }

  return events;
}

function scanShortManagement(bars, startIndex) {
  const events = [];
  let runningLowBar = bars[startIndex];
  let currentSL = Infinity; // SL only moves down for shorts
  let i = startIndex;

  while (i < bars.length) {
    // Update running low
    if (bars[i].l < runningLowBar.l) {
      runningLowBar = bars[i];
    }

    const moveToLow = runningLowBar.h;

    // Detect sign of strength: candle closing above move to low
    if (bars[i].c > moveToLow) {
      const sosBar = bars[i];
      const sosIndex = i;
      const invalidationLevel = sosBar.l; // low of SOS candle

      // Check very next candle
      if (i + 1 >= bars.length) break;
      const nextBar = bars[i + 1];

      if (nextBar.c < invalidationLevel) {
        // Immediate recovery — dismiss, continue from next candle
        i = i + 2;
        continue;
      }

      // No immediate recovery — scan forward until recovery
      let recoveryIndex = null;
      for (let j = i + 2; j < bars.length; j++) {
        if (bars[j].c < invalidationLevel) {
          recoveryIndex = j;
          break;
        }
      }

      if (recoveryIndex === null) {
        break;
      }

      // Find highest point between SOS candle and recovery candle
      let highestBar = bars[sosIndex];
      let highestIndex = sosIndex;
      for (let j = sosIndex; j <= recoveryIndex; j++) {
        if (bars[j].h > highestBar.h) {
          highestBar = bars[j];
          highestIndex = j;
        }
      }

      const newSL = wickMidpoint(highestBar, 'short');

      // SL only moves down for shorts — skip if new SL is higher than current
      if (newSL < currentSL) {
        currentSL = newSL;
        events.push({
          newSL,
          sosBar,
          sosIndex,
          recoveryBar: bars[recoveryIndex],
          recoveryIndex,
          highestBar,
          highestIndex,
        });
      }

      // Continue scanning from recovery candle, update running low
      i = recoveryIndex;
      runningLowBar = bars[recoveryIndex];
      continue;
    }

    i++;
  }

  return events;
}

// ── Public API ──

export async function loadSession(contractId, date, { startMinute = 450, endMinute = null } = {}) {
  // Fetch bars from 4:00 AM to 11:00 PM ET to have enough history for backwards scanning
  const d = new Date(date + 'T00:00:00Z');
  const from = new Date(d); from.setUTCHours(8, 0, 0, 0);   // 4 AM ET (UTC-4)
  const to = new Date(d); to.setUTCHours(27, 0, 0, 0);      // 11 PM ET

  const bars = await fetchBars(contractId, from.toISOString(), to.toISOString());
  if (bars.length === 0) return { bars: [], low: null, high: null, sos: null, sow: null };

  const low = findAnchorLow(bars, startMinute, endMinute);
  const high = findAnchorHigh(bars, startMinute, endMinute);

  const sos = low ? detectSOS(bars, low.index) : null;
  const sow = high ? detectSOW(bars, high.index) : null;

  return { bars, low, high, sos, sow };
}
