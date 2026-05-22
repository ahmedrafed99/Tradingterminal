import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { marketDataService, type Contract } from '../../services/marketDataService';
import { positionService } from '../../services/positionService';
import { realtimeService, type GatewayQuote } from '../../services/realtimeService';
import { tradeService, type Trade } from '../../services/tradeService';
import { useStore } from '../../store/useStore';
import { OrderSide, OrderStatus, OrderType, PositionType } from '../../types/enums';
import { shortSymbol, formatTime, formatDuration, formatAccountName } from '../../utils/formatters';
import { calcPnl, roundToTick } from '../../utils/instrument';
import { tradingDurationMs } from '../../utils/marketHours';
import { markAsManualClose } from '../../services/manualCloseTracker';
import { showToast, errorMessage } from '../../utils/toast';
import { CustomSelect } from '../shared/CustomSelect';
import { allTradesCache } from './TradesTab';
import { getDateRange } from '../../utils/cmeSession';

type SortColumn = 'time' | 'side' | 'symbol' | 'qty' | 'entry' | 'pts' | 'pnl' | 'tp' | 'sl' | 'duration';
type SortDir = 'asc' | 'desc';

interface PositionRow {
  key: string; // accountId:contractId
  accountId: string;
  accountName: string;
  contractId: string;
  contract: Contract | null;
  size: number;
  averagePrice: number;
  isLong: boolean;
  openTime: string | null;       // ISO
  ptsTaken: number | null;       // avg pts captured per closed-contract (null if no partials)
  contractsClosed: number;
  tpPrice: number | null;
  tpCount: number;
  slPrice: number | null;
  lastPrice: number | null;
}

const EMPTY = '—';

/**
 * Walk trades for one (accountId, contractId) to find the active OPEN segment:
 * the run of fills that begins when net size leaves 0 and is still open today.
 * Returns the segment's open trades, partial-close trades, and entry timestamp.
 */
function findOpenSegment(allTrades: Trade[], contractId: string, currentSize: number, isLong: boolean): {
  openTime: string | null;
  closes: Trade[];
} {
  const dir = isLong ? 1 : -1;
  const filtered = allTrades
    .filter((t) => String(t.contractId) === String(contractId) && !t.voided)
    .sort((a, b) => new Date(a.creationTimestamp).getTime() - new Date(b.creationTimestamp).getTime());

  // Walk forward; whenever net flips to 0, reset segment.
  let net = 0;
  let segmentOpens: Trade[] = [];
  let segmentCloses: Trade[] = [];
  for (const t of filtered) {
    const sign = t.side === OrderSide.Buy ? 1 : -1;
    const isOpen = t.profitAndLoss == null;
    if (isOpen) {
      segmentOpens.push(t);
      net += sign * t.size;
    } else {
      segmentCloses.push(t);
      net += sign * t.size;
    }
    if (net === 0) {
      segmentOpens = [];
      segmentCloses = [];
    }
  }
  // Only accept the segment if its remaining net matches direction and current size
  if (segmentOpens.length === 0 || Math.sign(net) !== dir || Math.abs(net) !== currentSize) {
    return { openTime: null, closes: [] };
  }
  return {
    openTime: segmentOpens[0].creationTimestamp,
    closes: segmentCloses,
  };
}

/** Avg pts captured per closed contract — uses contract price diff if available, else P&L/tickValue fallback. */
function calcPtsTaken(closes: Trade[], averagePrice: number, isLong: boolean): { pts: number; contracts: number } {
  const dir = isLong ? 1 : -1;
  let weightedPts = 0;
  let contracts = 0;
  for (const c of closes) {
    const pts = (c.price - averagePrice) * dir;
    weightedPts += pts * c.size;
    contracts += c.size;
  }
  return { pts: contracts > 0 ? weightedPts / contracts : 0, contracts };
}

export function PositionsTab() {
  // tick bumps on every rAF-batched quote update; rows useMemo depends on it
  // so live lastPrice flows through even when no other dep changes.
  const [tick, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const {
    positions, openOrders, accounts, activeAccountId, connected, orderContract,
    contract: leftContract, secondContract, selectedChart, dualChart, pnlMode,
    setContract, setSecondContract, setOrderContract, setActiveAccountId, setPnlMode,
    positionsAccountFilter, positionsInstrumentFilter,
    setPositionsAccountFilter, setPositionsInstrumentFilter,
    setOpenPositions, storeLastPrice,
  } = useStore(useShallow((s) => ({
    positions: s.positions,
    openOrders: s.openOrders,
    accounts: s.accounts,
    activeAccountId: s.activeAccountId,
    connected: s.connected,
    orderContract: s.orderContract,
    contract: s.contract,
    secondContract: s.secondContract,
    selectedChart: s.selectedChart,
    dualChart: s.dualChart,
    pnlMode: s.pnlMode,
    setContract: s.setContract,
    setSecondContract: s.setSecondContract,
    setOrderContract: s.setOrderContract,
    setActiveAccountId: s.setActiveAccountId,
    setPnlMode: s.setPnlMode,
    positionsAccountFilter: s.positionsAccountFilter,
    positionsInstrumentFilter: s.positionsInstrumentFilter,
    setPositionsAccountFilter: s.setPositionsAccountFilter,
    setPositionsInstrumentFilter: s.setPositionsInstrumentFilter,
    setOpenPositions: s.setOpenPositions,
    storeLastPrice: s.lastPrice,
  })));

  const contractsRef = useRef<Map<string, Contract>>(new Map());
  const pricesRef = useRef<Map<string, number>>(new Map());
  const subscribedRef = useRef<Set<string>>(new Set());
  const fetchedAccountsRef = useRef<Set<string>>(new Set());

  // ── Lazy fetch positions for non-active accounts when 'all' is selected ──
  useEffect(() => {
    if (!connected || positionsAccountFilter !== 'all') return;
    let cancelled = false;
    for (const acct of accounts) {
      if (acct.id === activeAccountId) continue;
      if (fetchedAccountsRef.current.has(acct.id)) continue;
      fetchedAccountsRef.current.add(acct.id);
      positionService.searchOpenPositions(acct.id)
        .then((open) => {
          if (cancelled) return;
          setOpenPositions(open, acct.id);
        })
        .catch(() => { /* tolerated — gateway may not support */ });
    }
    return () => { cancelled = true; };
  }, [connected, positionsAccountFilter, accounts, activeAccountId, setOpenPositions]);

  // ── Lazy fetch trades for non-active accounts (used for openTime + ptsTaken) ──
  useEffect(() => {
    if (!connected || positionsAccountFilter !== 'all') return;
    let cancelled = false;
    // Match TradesTab window so findOpenSegment sees positions opened any time ago
    const { startTimestamp } = getDateRange('all');
    for (const acct of accounts) {
      if (acct.id === activeAccountId) continue;
      if (allTradesCache.has(acct.id)) continue;
      tradeService.searchTrades(acct.id, startTimestamp)
        .then((trades) => {
          if (cancelled) return;
          allTradesCache.set(acct.id, trades);
          forceUpdate();
        })
        .catch(() => { /* non-fatal */ });
    }
    return () => { cancelled = true; };
  }, [connected, positionsAccountFilter, accounts, activeAccountId]);

  // ── Subscribe to quotes + cache contracts for all displayed positions ──
  useEffect(() => {
    if (!connected) return;
    // Seed cache with any known contracts from the store
    if (orderContract) contractsRef.current.set(orderContract.id, orderContract);
    if (leftContract) contractsRef.current.set(leftContract.id, leftContract);
    if (secondContract) contractsRef.current.set(secondContract.id, secondContract);

    const interesting = new Set<string>();
    for (const p of positions) {
      if (p.size === 0) continue;
      if (positionsAccountFilter === 'current' && p.accountId !== activeAccountId) continue;
      interesting.add(String(p.contractId));
    }

    for (const cid of interesting) {
      if (!subscribedRef.current.has(cid)) {
        realtimeService.subscribeQuotes(cid);
        subscribedRef.current.add(cid);
      }
      if (!contractsRef.current.has(cid)) {
        const symbol = cid.split('.')[3];
        if (symbol) {
          marketDataService.searchContracts(symbol).then((contracts) => {
            const match = contracts.find((c) => c.id === cid);
            if (match) {
              contractsRef.current.set(cid, match);
              forceUpdate();
            }
          }).catch(() => { /* non-fatal */ });
        }
      }
    }
  }, [positions, connected, positionsAccountFilter, activeAccountId, orderContract, leftContract, secondContract]);

  // ── Listen for quote updates (rAF-throttled) ──
  useEffect(() => {
    if (!connected) return;
    let rafId = 0;
    let dirty = false;
    const handler = (contractId: string, q: GatewayQuote) => {
      if (!subscribedRef.current.has(contractId)) return;
      if (q.lastPrice == null) return;
      pricesRef.current.set(contractId, q.lastPrice);
      dirty = true;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (dirty) { dirty = false; forceUpdate(); }
        });
      }
    };
    realtimeService.onQuote(handler);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      realtimeService.offQuote(handler);
    };
  }, [connected]);

  // ── Build rows ──
  const accountMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const rows = useMemo<PositionRow[]>(() => {
    const activeContractId = selectedChart === 'left'
      ? leftContract?.id
      : secondContract?.id;

    return positions
      .filter((p) => p.size > 0)
      .filter((p) => positionsAccountFilter === 'all' || p.accountId === activeAccountId)
      .filter((p) => positionsInstrumentFilter === 'all'
        || (activeContractId && String(p.contractId) === String(activeContractId)))
      .map((p) => {
        const isLong = p.type === PositionType.Long;
        const contract = contractsRef.current.get(String(p.contractId)) ?? null;
        const trades = allTradesCache.get(p.accountId) ?? [];
        const seg = findOpenSegment(trades, String(p.contractId), p.size, isLong);
        const { pts, contracts: contractsClosed } = calcPtsTaken(seg.closes, p.averagePrice, isLong);

        // Match SL/TP orders — opposite side, same contract, suspended/active leg.
        // openOrders is scoped to the active account only; for positions on other
        // accounts we can't introspect their bracket legs (gateway doesn't expose
        // others' orders), so TP/SL render as '—'.
        const oppSide = isLong ? OrderSide.Sell : OrderSide.Buy;
        const sameAccount = p.accountId === activeAccountId;
        const bracketLegs = sameAccount ? openOrders.filter((o) =>
          String(o.contractId) === String(p.contractId)
          && o.side === oppSide
          && (o.status === OrderStatus.Working || o.status === OrderStatus.Pending || o.status === OrderStatus.Suspended),
        ) : [];
        const slLegs = bracketLegs.filter((o) =>
          o.customTag?.endsWith('-SL')
          ?? (o.type === OrderType.Stop || o.type === OrderType.TrailingStop),
        );
        const tpLegs = bracketLegs
          .filter((o) =>
            o.customTag?.endsWith('-TP')
            ?? (o.type === OrderType.Limit),
          )
          // Sort ascending for long (closest TP above entry first), descending for short
          .sort((a, b) => {
            const pa = a.limitPrice ?? Infinity;
            const pb = b.limitPrice ?? Infinity;
            return isLong ? pa - pb : pb - pa;
          });

        // Use orderContract's live lastPrice if it matches; else cached tick
        const cid = String(p.contractId);
        const lp = (orderContract && cid === orderContract.id && storeLastPrice != null)
          ? storeLastPrice
          : (pricesRef.current.get(cid) ?? null);

        return {
          key: `${p.accountId}:${cid}`,
          accountId: p.accountId,
          accountName: accountMap.get(p.accountId) ?? p.accountId,
          contractId: cid,
          contract,
          size: p.size,
          averagePrice: p.averagePrice,
          isLong,
          openTime: seg.openTime,
          ptsTaken: contractsClosed > 0 ? pts : null,
          contractsClosed,
          tpPrice: tpLegs[0]?.limitPrice ?? null,
          tpCount: tpLegs.length,
          slPrice: slLegs[0]?.stopPrice ?? null,
          lastPrice: lp,
        } as PositionRow;
      });
  }, [
    positions, openOrders, positionsAccountFilter, positionsInstrumentFilter,
    activeAccountId, leftContract, secondContract, selectedChart, accountMap,
    orderContract, storeLastPrice, tick,
  ]);

  // ── Sort ──
  const [sortCol, setSortCol] = useState<SortColumn>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = useCallback((col: SortColumn) => {
    if (col === sortCol) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }, [sortCol, sortDir]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const v = (r: PositionRow): number | string => {
      switch (sortCol) {
        case 'time': return r.openTime ?? '';
        case 'side': return r.isLong ? 'Long' : 'Short';
        case 'symbol': return shortSymbol(r.contractId);
        case 'qty': return r.size;
        case 'entry': return r.averagePrice;
        case 'pts': return r.ptsTaken ?? -Infinity;
        case 'pnl': {
          if (r.lastPrice == null || !r.contract) return -Infinity;
          const diff = r.isLong ? r.lastPrice - r.averagePrice : r.averagePrice - r.lastPrice;
          return calcPnl(diff, r.contract, r.size);
        }
        case 'tp': return r.tpPrice ?? -Infinity;
        case 'sl': return r.slPrice ?? -Infinity;
        case 'duration': return r.openTime ? tradingDurationMs(r.openTime, new Date().toISOString()) : 0;
      }
    };
    return [...rows].sort((a, b) => {
      const va = v(a); const vb = v(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [rows, sortCol, sortDir]);

  // ── Actions ──
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [flatteningAll, setFlatteningAll] = useState(false);

  const handleRowClick = useCallback((r: PositionRow) => {
    if (!r.contract) return;
    if (r.accountId !== activeAccountId) setActiveAccountId(r.accountId);
    // Set the active chart's contract (matches InstrumentSelector behavior)
    if (dualChart && selectedChart === 'right') setSecondContract(r.contract);
    else setContract(r.contract);
    setOrderContract(r.contract);
  }, [activeAccountId, dualChart, selectedChart, setActiveAccountId, setContract, setSecondContract, setOrderContract]);

  const handleClose = useCallback(async (r: PositionRow) => {
    setClosingKey(r.key);
    try {
      markAsManualClose(r.contractId);
      await positionService.closePosition(r.accountId, r.contractId);
    } catch (err) {
      showToast('error', 'Failed to close position', errorMessage(err));
    } finally {
      setClosingKey(null);
    }
  }, []);

  const handleFlattenAll = useCallback(async () => {
    if (sortedRows.length === 0) return;
    setFlatteningAll(true);
    try {
      for (const r of sortedRows) markAsManualClose(r.contractId);
      const { ok, failed } = await positionService.closeMany(
        sortedRows.map((r) => ({ accountId: r.accountId, contractId: r.contractId })),
      );
      if (failed > 0) showToast('error', `Closed ${ok} · ${failed} failed`, '');
      else showToast('info', `Flattened ${ok} position${ok === 1 ? '' : 's'}`, '');
    } finally {
      setFlatteningAll(false);
    }
  }, [sortedRows]);

  const togglePnlMode = useCallback(() => setPnlMode(pnlMode === '$' ? 'points' : '$'), [pnlMode, setPnlMode]);

  // TP/SL display mode — cycles independently of global pnlMode
  // 'price' → show raw price · '$' → projected P&L in dollars · 'pts' → projected P&L in points
  const [tpSlMode, setTpSlMode] = useState<'price' | '$' | 'pts'>('price');
  const cycleTpSlMode = useCallback(() => {
    setTpSlMode((m) => m === 'price' ? '$' : m === '$' ? 'pts' : 'price');
  }, []);

  // ── Layout ──
  // minmax(0,Nfr) prevents content from driving column width — badges never push neighbours
  const cols = 'grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,0.5fr)]';
  let rowIdx = 0;

  const headerCells: [string, SortColumn][] = [
    ['Time', 'time'],
    ['Side', 'side'],
    ['Symbol', 'symbol'],
    ['Qty', 'qty'],
    ['Entry', 'entry'],
    ['Pts Taken', 'pts'],
    ['Unreal P&L', 'pnl'],
    ['Duration', 'duration'],
    ['TP', 'tp'],
    ['SL', 'sl'],
    ['', 'time'], // close button column — non-sortable visually
  ];

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div
        className="sticky top-0 bg-(--color-panel) border-b border-(--color-border)"
        style={{ zIndex: Z.HEADER }}
      >
        <div className="flex items-center h-8 relative">
          <div
            className={`grid ${cols} items-center h-8 text-(--color-text-muted) pl-4`}
            style={{ width: '70%' }}
          >
            {headerCells.map(([label, col], i) => {
              const isLast = i === headerCells.length - 1;
              const active = !isLast && sortCol === col;
              return (
                <div
                  key={`${label}-${i}`}
                  className={`px-3 text-center select-none ${isLast ? '' : 'cursor-pointer hover:text-(--color-text) transition-colors'} ${active ? 'text-(--color-text)' : ''}`}
                  onClick={isLast ? undefined : () => toggleSort(col)}
                >
                  {label}
                  {active && (
                    <span className="ml-0.5 text-[10px]">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2" style={{ paddingRight: 16 }}>
            <CustomSelect
              value={positionsAccountFilter}
              onChange={(v) => setPositionsAccountFilter(v as 'current' | 'all')}
              options={[
                { value: 'current', label: 'Current account' },
                { value: 'all', label: 'All accounts' },
              ]}
              padding="4px 8px"
              fontSize={11}
            />
            <CustomSelect
              value={positionsInstrumentFilter}
              onChange={(v) => setPositionsInstrumentFilter(v as 'current' | 'all')}
              options={[
                { value: 'current', label: 'Current symbol' },
                { value: 'all', label: 'All symbols' },
              ]}
              padding="4px 8px"
              fontSize={11}
            />
            <button
              onClick={handleFlattenAll}
              disabled={flatteningAll || sortedRows.length === 0}
              style={{ padding: '4px 10px' }}
              className="text-xs font-medium rounded border border-(--color-sell)/40 text-(--color-sell) hover:bg-(--color-sell)/10 hover:border-(--color-sell) transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={positionsAccountFilter === 'all'
                ? `Close every position visible (across all accounts) — ${sortedRows.length}`
                : `Close every visible position — ${sortedRows.length}`}
            >
              {flatteningAll
                ? 'Flattening…'
                : sortedRows.length > 0
                  ? `Flatten all (${sortedRows.length})`
                  : 'Flatten all'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {sortedRows.length === 0 ? (
        <div className="flex items-center justify-center text-(--color-text-dim) text-xs" style={{ height: 120 }}>
          No open positions
        </div>
      ) : (
        sortedRows.map((r) => {
          const stripe = rowIdx++ % 2 === 1 ? TABLE_ROW_STRIPE : '';
          const dir = r.isLong ? 1 : -1;

          // Unreal P&L
          const pnl = (r.lastPrice != null && r.contract)
            ? calcPnl((r.isLong ? r.lastPrice - r.averagePrice : r.averagePrice - r.lastPrice), r.contract, r.size)
            : null;
          const ptsLive = (r.lastPrice != null && r.contract)
            ? roundToTick((r.isLong ? r.lastPrice - r.averagePrice : r.averagePrice - r.lastPrice), r.contract.tickSize)
            : null;
          const pnlColor = pnl == null ? 'text-(--color-text-muted)'
            : pnl > 0 ? 'text-(--color-buy)' : pnl < 0 ? 'text-(--color-sell)' : 'text-(--color-text-muted)';

          // TP projected P&L — independent of global pnlMode
          const tpDiff = r.tpPrice != null ? (r.tpPrice - r.averagePrice) * dir : null;
          const tpProjPnl = tpDiff != null && r.contract ? calcPnl(tpDiff, r.contract, r.size) : null;
          const tpProjPts = tpDiff != null && r.contract ? roundToTick(tpDiff, r.contract.tickSize) : null;
          const tpVal = tpSlMode === '$' ? tpProjPnl : tpSlMode === 'pts' ? tpProjPts : null;
          const tpColor = tpSlMode === 'price' ? 'text-(--color-buy)'
            : tpVal == null ? 'text-(--color-buy)' : tpVal >= 0 ? 'text-(--color-buy)' : 'text-(--color-sell)';

          // SL projected P&L — independent of global pnlMode
          const slDiff = r.slPrice != null ? (r.slPrice - r.averagePrice) * dir : null;
          const slProjPnl = slDiff != null && r.contract ? calcPnl(slDiff, r.contract, r.size) : null;
          const slProjPts = slDiff != null && r.contract ? roundToTick(slDiff, r.contract.tickSize) : null;
          const slVal = tpSlMode === '$' ? slProjPnl : tpSlMode === 'pts' ? slProjPts : null;
          const slColor = tpSlMode === 'price' ? 'text-(--color-sell)'
            : slVal == null ? 'text-(--color-sell)' : slVal >= 0 ? 'text-(--color-buy)' : 'text-(--color-sell)';

          return (
            <div
              key={r.key}
              className={`${stripe} row-hover border border-transparent cursor-pointer`}
              style={{ contentVisibility: 'auto', containIntrinsicSize: '0 28px' }}
              onClick={() => handleRowClick(r)}
              title={positionsAccountFilter === 'all' ? `${r.accountName} · click to switch` : 'Click to focus chart'}
            >
              <div className={`grid ${cols} items-center pl-4 ${positionsAccountFilter === 'all' ? 'min-h-10 py-1' : 'h-7'}`} style={{ width: '70%' }}>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {r.openTime ? formatTime(r.openTime, true) : EMPTY}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  <span className={r.isLong ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
                    {r.isLong ? 'Long' : 'Short'}
                  </span>
                </div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap min-w-0 overflow-hidden">
                  {shortSymbol(r.contractId)}
                  {positionsAccountFilter === 'all' && (() => {
                    const { label, id } = formatAccountName(r.accountName);
                    const suffix = id ? id.slice(-2) : '';
                    const full = `${label}${suffix ? ` - ${suffix}` : ''}`;
                    return (
                      <div
                        className="text-[10px] text-(--color-text-medium) leading-tight truncate mt-0.5"
                        title={full}
                      >
                        {full}
                      </div>
                    );
                  })()}
                </div>
                <div className="px-3 text-center text-(--color-text)">{r.size}</div>
                <div className="px-3 text-center text-(--color-text) whitespace-nowrap">
                  {r.averagePrice.toFixed(2)}
                </div>
                <div className="px-3 text-center whitespace-nowrap">
                  {r.ptsTaken == null ? (
                    <span className="text-(--color-text-dim)">{EMPTY}</span>
                  ) : (
                    <span className={r.ptsTaken >= 0 ? 'text-(--color-buy)' : 'text-(--color-sell)'}>
                      {r.ptsTaken >= 0 ? '+' : ''}{r.ptsTaken.toFixed(2)}pt
                      <span className="text-(--color-text-dim)"> ({r.contractsClosed})</span>
                    </span>
                  )}
                </div>
                <div className={`px-3 text-center whitespace-nowrap ${pnlColor} font-medium`}>
                  {pnl == null || ptsLive == null ? (
                    EMPTY
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <span>
                        {pnlMode === '$'
                          ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`
                          : `${ptsLive >= 0 ? '+' : ''}${ptsLive.toFixed(2)}`}
                      </span>
                      <span
                        onClick={(e) => { e.stopPropagation(); togglePnlMode(); }}
                        title={pnlMode === '$' ? 'Switch to points' : 'Switch to dollars'}
                        className="cursor-pointer rounded opacity-60 hover:opacity-100 hover:bg-(--color-hover-row) hover:ring-1 hover:ring-(--color-border) transition-all"
                        style={{ padding: '2px 6px' }}
                      >
                        {pnlMode === '$' ? '$' : 'pt'}
                      </span>
                    </span>
                  )}
                </div>
                <div className="px-3 text-center text-(--color-text-muted) whitespace-nowrap">
                  {r.openTime ? formatDuration(tradingDurationMs(r.openTime, new Date().toISOString())) : EMPTY}
                </div>
                {/* TP */}
                <div className="px-3 text-center whitespace-nowrap overflow-hidden">
                  {r.tpPrice == null ? (
                    <span className="text-(--color-text-dim)">{EMPTY}</span>
                  ) : tpSlMode === 'price' ? (
                    <span
                      className="text-(--color-buy) cursor-pointer rounded px-1 hover:bg-(--color-hover-row) hover:font-semibold transition-all"
                      onClick={(e) => { e.stopPropagation(); cycleTpSlMode(); }}
                      title="Show projected P&L"
                    >
                      {r.tpPrice.toFixed(2)}
                      {r.tpCount > 1 && <span className="text-(--color-text-dim) font-normal"> +{r.tpCount - 1}</span>}
                    </span>
                  ) : (
                    <span
                      className="cursor-pointer rounded px-1 hover:bg-(--color-hover-row) hover:font-semibold transition-all"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={(e) => { e.stopPropagation(); cycleTpSlMode(); }}
                      title={tpSlMode === '$' ? 'Switch to points' : 'Show TP price'}
                    >
                      <span className={tpColor}>
                        {tpVal != null ? `${tpVal >= 0 ? '+' : ''}${tpVal.toFixed(2)}` : EMPTY}
                      </span>
                      <span className="text-(--color-text-muted) font-normal" style={{ opacity: 0.6 }}>
                        {tpSlMode === '$' ? '$' : 'pt'}
                      </span>
                    </span>
                  )}
                </div>
                {/* SL */}
                <div className="px-3 text-center whitespace-nowrap overflow-hidden">
                  {r.slPrice == null ? (
                    <span className="text-(--color-text-dim)">{EMPTY}</span>
                  ) : tpSlMode === 'price' ? (
                    <span
                      className="text-(--color-sell) cursor-pointer rounded px-1 hover:bg-(--color-hover-row) hover:font-semibold transition-all"
                      onClick={(e) => { e.stopPropagation(); cycleTpSlMode(); }}
                      title="Show projected P&L"
                    >
                      {r.slPrice.toFixed(2)}
                    </span>
                  ) : (
                    <span
                      className="cursor-pointer rounded px-1 hover:bg-(--color-hover-row) hover:font-semibold transition-all"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={(e) => { e.stopPropagation(); cycleTpSlMode(); }}
                      title={tpSlMode === '$' ? 'Switch to points' : 'Show SL price'}
                    >
                      <span className={slColor}>
                        {slVal != null ? `${slVal >= 0 ? '+' : ''}${slVal.toFixed(2)}` : EMPTY}
                      </span>
                      <span className="text-(--color-text-muted) font-normal" style={{ opacity: 0.6 }}>
                        {tpSlMode === '$' ? '$' : 'pt'}
                      </span>
                    </span>
                  )}
                </div>
                <div className="px-3 flex items-center justify-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClose(r); }}
                    disabled={closingKey === r.key}
                    className="flex items-center justify-center rounded-full text-(--color-sell) opacity-60 hover:opacity-100 hover:bg-(--color-border)/30 transition-all disabled:opacity-50"
                    style={{ width: 22, height: 22 }}
                    title="Flatten position"
                  >
                    {closingKey === r.key ? '…' : '✕'}
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
