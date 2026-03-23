/**
 * Trade statistics computation utilities.
 * All functions are pure — no side effects, no store access.
 */

import type { Trade } from '../services/tradeService';
import { OrderSide } from '../types/enums';
import { buildEntryMap } from '../components/chart/TradeZonePrimitive';
import { tradingDurationMs } from './marketHours';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GroupedTrade {
  entryId: number;
  entry: Trade | null;
  exits: Trade[];
  totalQty: number;
  totalPnl: number;
  totalFees: number;
  totalNet: number;
  entryTime: string;
  exitTime: string;
  isLong: boolean;
  entryPrice: number | null;
  exitPrice: number; // size-weighted average
}

export interface TradeStats {
  totalTrades: number;
  winners: number;
  losers: number;
  breakeven: number;
  winRate: number;
  netPnl: number;
  grossWins: number;
  grossLosses: number;
  profitFactor: number;
  avgWinner: number;
  avgLoser: number;
  avgRR: number;
  bestTrade: GroupedTrade | null;
  worstTrade: GroupedTrade | null;
  maxWinStreak: number;
  maxLossStreak: number;
  maxDrawdown: number;
  equityCurve: number[];
}

export interface DayPnl {
  date: string; // YYYY-MM-DD
  net: number;
  tradeCount: number;
  dayOfWeek: number; // 0=Sun, 1=Mon, ...
}

export interface HourPnl {
  hour: number; // 0-23 in ET
  net: number;
  count: number;
}

export interface DirectionStats {
  count: number;
  winners: number;
  losers: number;
  winRate: number;
  avgPnl: number;
  avgWinner: number;
  avgLoser: number;
  totalNet: number;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/** Group raw trades into logical trades (multi-exit = 1 trade). */
export function groupTrades(trades: Trade[]): GroupedTrade[] {
  const entryMap = buildEntryMap(trades);
  const closingTrades = trades.filter((t) => t.profitAndLoss != null && !t.voided);

  const byEntry = new Map<number, Trade[]>();
  const unmatched: Trade[] = [];

  for (const t of closingTrades) {
    const entry = entryMap.get(t.id);
    if (!entry) {
      unmatched.push(t);
      continue;
    }
    const key = entry.id;
    if (!byEntry.has(key)) byEntry.set(key, []);
    byEntry.get(key)!.push(t);
  }

  const result: GroupedTrade[] = [];

  for (const [entryId, exits] of byEntry) {
    exits.sort(
      (a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime(),
    );
    const entry = entryMap.get(exits[0].id)!;
    const totalPnl = exits.reduce((s, t) => s + t.profitAndLoss!, 0);
    const totalFees = exits.reduce((s, t) => s + t.fees, 0);
    const totalQty = exits.reduce((s, t) => s + t.size, 0);
    const weightedPrice = exits.reduce((s, t) => s + t.price * t.size, 0) / totalQty;

    result.push({
      entryId,
      entry,
      exits,
      totalQty,
      totalPnl,
      totalFees,
      totalNet: totalPnl - totalFees,
      entryTime: entry.creationTimestamp,
      exitTime: exits[exits.length - 1].creationTimestamp,
      isLong: exits[0].side !== OrderSide.Buy,
      entryPrice: entry.price,
      exitPrice: weightedPrice,
    });
  }

  for (const t of unmatched) {
    result.push({
      entryId: -t.id,
      entry: null,
      exits: [t],
      totalQty: t.size,
      totalPnl: t.profitAndLoss!,
      totalFees: t.fees,
      totalNet: t.profitAndLoss! - t.fees,
      entryTime: t.creationTimestamp,
      exitTime: t.creationTimestamp,
      isLong: t.side !== OrderSide.Buy,
      entryPrice: null,
      exitPrice: t.price,
    });
  }

  // Sort by entry time
  result.sort(
    (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime(),
  );

  return result;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function computeStats(grouped: GroupedTrade[]): TradeStats {
  if (grouped.length === 0) {
    return {
      totalTrades: 0, winners: 0, losers: 0, breakeven: 0,
      winRate: 0, netPnl: 0, grossWins: 0, grossLosses: 0,
      profitFactor: 0, avgWinner: 0, avgLoser: 0, avgRR: 0,
      bestTrade: null, worstTrade: null,
      maxWinStreak: 0, maxLossStreak: 0, maxDrawdown: 0,
      equityCurve: [],
    };
  }

  const wins = grouped.filter((t) => t.totalNet > 0);
  const losses = grouped.filter((t) => t.totalNet < 0);
  const be = grouped.filter((t) => t.totalNet === 0);

  const grossWins = wins.reduce((s, t) => s + t.totalNet, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.totalNet, 0));

  const avgWinner = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoser = losses.length > 0 ? grossLosses / losses.length : 0;

  // Equity curve + drawdown
  const curve: number[] = [];
  let running = 0;
  let peak = 0;
  let maxDD = 0;

  for (const t of grouped) {
    running += t.totalNet;
    curve.push(running);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }

  // Streaks
  let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0;
  for (const t of grouped) {
    if (t.totalNet > 0) {
      winStreak++;
      lossStreak = 0;
      if (winStreak > maxWin) maxWin = winStreak;
    } else if (t.totalNet < 0) {
      lossStreak++;
      winStreak = 0;
      if (lossStreak > maxLoss) maxLoss = lossStreak;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
  }

  // Best / worst
  let best = grouped[0];
  let worst = grouped[0];
  for (const t of grouped) {
    if (t.totalNet > best.totalNet) best = t;
    if (t.totalNet < worst.totalNet) worst = t;
  }

  return {
    totalTrades: grouped.length,
    winners: wins.length,
    losers: losses.length,
    breakeven: be.length,
    winRate: grouped.length > 0 ? wins.length / grouped.length : 0,
    netPnl: running,
    grossWins,
    grossLosses,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    avgWinner,
    avgLoser,
    avgRR: avgLoser > 0 ? avgWinner / avgLoser : 0,
    bestTrade: best,
    worstTrade: worst,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    maxDrawdown: maxDD,
    equityCurve: curve,
  };
}

// ── Calendar ─────────────────────────────────────────────────────────────────

/** Group trades by calendar day (New York time). */
export function buildCalendarData(grouped: GroupedTrade[]): DayPnl[] {
  const byDay = new Map<string, { net: number; count: number }>();

  for (const t of grouped) {
    const d = new Date(t.exitTime);
    const ny = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
    const prev = byDay.get(ny) ?? { net: 0, count: 0 };
    byDay.set(ny, { net: prev.net + t.totalNet, count: prev.count + 1 });
  }

  const result: DayPnl[] = [];
  for (const [date, { net, count }] of byDay) {
    const d = new Date(date + 'T12:00:00'); // midday to avoid TZ issues
    result.push({ date, net, tradeCount: count, dayOfWeek: d.getDay() });
  }

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

// ── Time of day ──────────────────────────────────────────────────────────────

/** Average P&L by hour of day (ET). */
export function buildHourlyData(grouped: GroupedTrade[]): HourPnl[] {
  const buckets = new Map<number, { total: number; count: number }>();

  for (const t of grouped) {
    const d = new Date(t.entryTime);
    const hour = parseInt(
      d.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/New_York' }),
      10,
    );
    const prev = buckets.get(hour) ?? { total: 0, count: 0 };
    buckets.set(hour, { total: prev.total + t.totalNet, count: prev.count + 1 });
  }

  const result: HourPnl[] = [];
  for (const [hour, { total, count }] of buckets) {
    result.push({ hour, net: total, count });
  }

  result.sort((a, b) => a.hour - b.hour);
  return result;
}

// ── Direction breakdown ──────────────────────────────────────────────────────

export function buildDirectionStats(grouped: GroupedTrade[]): { long: DirectionStats; short: DirectionStats } {
  const build = (trades: GroupedTrade[]): DirectionStats => {
    const w = trades.filter((t) => t.totalNet > 0);
    const l = trades.filter((t) => t.totalNet < 0);
    const grossWins = w.reduce((s, t) => s + t.totalNet, 0);
    const grossLosses = Math.abs(l.reduce((s, t) => s + t.totalNet, 0));
    return {
      count: trades.length,
      winners: w.length,
      losers: l.length,
      winRate: trades.length > 0 ? w.length / trades.length : 0,
      avgPnl: trades.length > 0 ? trades.reduce((s, t) => s + t.totalNet, 0) / trades.length : 0,
      avgWinner: w.length > 0 ? grossWins / w.length : 0,
      avgLoser: l.length > 0 ? grossLosses / l.length : 0,
      totalNet: trades.reduce((s, t) => s + t.totalNet, 0),
    };
  };

  return {
    long: build(grouped.filter((t) => t.isLong)),
    short: build(grouped.filter((t) => !t.isLong)),
  };
}

// ── Day of week breakdown ────────────────────────────────────────────────────

export interface DayOfWeekPnl {
  day: string;
  avgNet: number;
  totalNet: number;
  count: number;
}

export function buildDayOfWeekData(calendarData: DayPnl[]): DayOfWeekPnl[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const buckets = new Map<number, { total: number; count: number }>();

  for (const d of calendarData) {
    const prev = buckets.get(d.dayOfWeek) ?? { total: 0, count: 0 };
    buckets.set(d.dayOfWeek, { total: prev.total + d.net, count: prev.count + 1 });
  }

  const result: DayOfWeekPnl[] = [];
  // Only weekdays (1=Mon to 5=Fri)
  for (let i = 1; i <= 5; i++) {
    const b = buckets.get(i);
    result.push({
      day: days[i],
      avgNet: b ? b.total / b.count : 0,
      totalNet: b?.total ?? 0,
      count: b?.count ?? 0,
    });
  }
  return result;
}

// ── Duration comparison ──────────────────────────────────────────────────────

export interface DurationComparison {
  avgWinnerDuration: number; // ms
  avgLoserDuration: number;  // ms
}

export function buildDurationComparison(grouped: GroupedTrade[]): DurationComparison {
  const withEntry = grouped.filter((t) => t.entry != null);
  const winners = withEntry.filter((t) => t.totalNet > 0);
  const losers = withEntry.filter((t) => t.totalNet < 0);

  const avgDur = (trades: GroupedTrade[]) => {
    if (trades.length === 0) return 0;
    const total = trades.reduce(
      (s, t) => s + tradingDurationMs(t.entryTime, t.exitTime),
      0,
    );
    return total / trades.length;
  };

  return {
    avgWinnerDuration: avgDur(winners),
    avgLoserDuration: avgDur(losers),
  };
}
