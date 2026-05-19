import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { RADIUS, SHADOW, Z } from '../../constants/layout';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { useStore } from '../../store/useStore';
import { resolveConditionServerUrl } from '../../store/slices/conditionsSlice';
import { conditionService } from '../../services/conditionService';
import type { Condition } from '../../services/conditionService';
import { shortSymbol } from '../../utils/formatters';
import { useClickOutside } from '../../hooks/useClickOutside';
import { syncForwarder } from '../../services/conditionTickForwarder';
import { OrderSide, OrderStatus, OrderType } from '../../types/enums';
import { pointsToPrice } from '../../utils/instrument';
import { fitTpsToOrderSize } from '../chart/hooks/resolvePreviewConfig';

const ALL_STATUSES = ['armed', 'paused', 'triggered', 'failed', 'expired'] as const;
type ConditionStatus = (typeof ALL_STATUSES)[number];

const STATUS_COLORS: Record<string, string> = {
  armed: 'text-(--color-buy)',
  paused: 'text-(--color-text-muted)',
  triggered: 'text-(--color-accent)',
  failed: 'text-(--color-sell)',
  expired: 'text-(--color-text-muted)',
};

const STATUS_LABELS: Record<string, string> = {
  armed: 'Armed',
  paused: 'Paused',
  triggered: 'Triggered',
  failed: 'Failed',
  expired: 'Expired',
};

const cols = 'grid-cols-[0.8fr_1fr_0.8fr_0.6fr_0.8fr_0.6fr_0.6fr_0.4fr]';

export function ConditionsTab() {
  const conditions = useStore((s) => s.conditions);
  const serverUrl = useStore((s) => resolveConditionServerUrl(s.conditionServerUrl));
  const setConditions = useStore((s) => s.setConditions);
  const upsertCondition = useStore((s) => s.upsertCondition);
  const removeCondition = useStore((s) => s.removeCondition);
  const addToast = useStore((s) => s.addToast);
  const openConditionModal = useStore((s) => s.openConditionModal);
  const conditionPreview = useStore((s) => s.conditionPreview);
  const setConditionPreview = useStore((s) => s.setConditionPreview);

  const [actionId, setActionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<ConditionStatus>>(new Set(['armed', 'paused']));
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  useClickOutside(filterRef, filterOpen, closeFilter);

  const filteredConditions = useMemo(
    () => conditions.filter((c) => statusFilter.has(c.status as ConditionStatus)),
    [conditions, statusFilter],
  );

  function toggleStatus(s: ConditionStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  }

  function applyConditionBracketInfo(c: Condition) {
    if (!c.bracket?.enabled || c.orderPrice == null || c.orderType !== 'limit') return;

    const side = c.orderSide === 'buy' ? OrderSide.Buy : OrderSide.Sell;
    const entryPrice = c.orderPrice;

    // Resolve contract for accurate point→price conversion; fall back to tick formula
    const storeContract = useStore.getState().contract;
    const contract = storeContract?.id === c.contractId
      ? storeContract
      : { tickSize: c.contractTickSize, ticksPerPoint: Math.round(1 / c.contractTickSize) } as Parameters<typeof pointsToPrice>[1];

    const toP = (pts: number) => pointsToPrice(pts, contract);
    const rawTps = (c.bracket.tp ?? []).map((tp, i) => ({
      id: String(i),
      points: tp.points,
      size: tp.size ?? c.orderSize,
    }));
    const fittedTps = fitTpsToOrderSize(rawTps, c.orderSize);

    useStore.getState().setPendingBracketInfo({
      entryPrice,
      slPrice: c.bracket.sl && c.bracket.sl.points > 0
        ? (side === OrderSide.Buy ? entryPrice - toP(c.bracket.sl.points) : entryPrice + toP(c.bracket.sl.points))
        : null,
      tpPrices: fittedTps.map((tp) =>
        side === OrderSide.Buy ? entryPrice + toP(tp.points) : entryPrice - toP(tp.points),
      ),
      side,
      orderSize: c.orderSize,
      tpSizes: fittedTps.map((tp) => tp.size),
      fromCondition: true,
    });

    useStore.setState({
      previewHideEntry: true,
      previewSide: side,
      limitPrice: entryPrice,
      orderType: 'limit',
      draftSlPoints: c.bracket.sl && c.bracket.sl.points > 0 ? c.bracket.sl.points : null,
      draftTpPoints: fittedTps.map((tp) => tp.points),
    });

    if (c.triggeredOrderId) {
      useStore.getState().setPendingEntryOrderId(c.triggeredOrderId);
    }

    // WS bracket Suspended events may have arrived before this SSE. Retroactively
    // patch any already-stored Suspended legs that missed the ws:suspended-override.
    const bi = useStore.getState().pendingBracketInfo;
    if (bi) {
      const oppSide = side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
      const suspended = useStore.getState().openOrders.filter(
        (o) => o.status === OrderStatus.Suspended && String(o.contractId) === String(c.contractId),
      );
      const slOrder = suspended.find(
        (o) => o.side === oppSide && (o.type === OrderType.Stop || o.type === OrderType.TrailingStop),
      );
      if (slOrder && bi.slPrice != null) {
        useStore.getState().upsertOrder({ ...slOrder, stopPrice: bi.slPrice });
      }
      const tpOrders = suspended.filter((o) => o.side === oppSide && o.type === OrderType.Limit);
      bi.tpPrices.forEach((tpPrice, i) => {
        if (tpOrders[i]) {
          useStore.getState().upsertOrder({ ...tpOrders[i], limitPrice: tpPrice });
        }
      });
    }
  }

  // Tick forwarder — forward live quotes to backend for real-time condition evaluation
  useEffect(() => {
    const hasArmed = conditions.some((c) => c.status === 'armed');
    syncForwarder(hasArmed);
    return () => syncForwarder(false);
  }, [conditions]);

  // SSE connection
  useEffect(() => {
    // Initial fetch
    conditionService.getAll(serverUrl).then(setConditions).catch((err) => {
      console.error('[ConditionsTab] Initial fetch failed:', err instanceof Error ? err.message : err);
    });

    // SSE stream
    const es = conditionService.subscribe(serverUrl, {
      onSnapshot: setConditions,
      onTriggered: (c) => {
        upsertCondition(c);
        addToast({ kind: 'success', title: `Condition triggered: ${c.conditionType} ${c.triggerPrice}`, duration: 3000 });
        applyConditionBracketInfo(c);
      },
      onFailed: (c) => {
        upsertCondition(c);
        addToast({ kind: 'error', title: `Condition failed: ${c.errorMessage ?? 'Unknown'}`, duration: 8000 });
      },
      onExpired: (c) => {
        upsertCondition(c);
      },
    });
    esRef.current = es;

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [serverUrl, setConditions, upsertCondition, addToast]);

  async function handlePauseResume(condition: Condition) {
    setActionId(condition.id);
    try {
      const updated =
        condition.status === 'armed'
          ? await conditionService.pause(serverUrl, condition.id)
          : await conditionService.resume(serverUrl, condition.id);
      upsertCondition(updated);
    } catch (err) {
      console.warn('[ConditionsTab] Pause/resume failed:', err instanceof Error ? err.message : err);
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(id: string) {
    setActionId(id);
    try {
      await conditionService.remove(serverUrl, id);
      removeCondition(id);
    } catch (err) {
      console.error('[ConditionsTab] Delete failed:', err instanceof Error ? err.message : err);
    } finally {
      setActionId(null);
    }
  }

  const isFilterAll = statusFilter.size === ALL_STATUSES.length;
  const filterLabel = isFilterAll
    ? 'All statuses'
    : statusFilter.size === 1
      ? STATUS_LABELS[[...statusFilter][0]]
      : `Status (${statusFilter.size})`;

  const statusFilterEl = (
    <div className="relative" ref={filterRef}>
      <button
        onClick={() => setFilterOpen(!filterOpen)}
        style={{
          background: 'var(--color-input)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: RADIUS.XL,
          padding: '4px 8px',
          fontSize: 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'border-color var(--transition-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-dim)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
      >
        <span>{filterLabel}</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d="M0 0l4 5 4-5z" />
        </svg>
      </button>
      {filterOpen && (
        <div
          className="absolute right-0 top-full mt-1 border border-(--color-border) animate-dropdown-in"
          style={{
            zIndex: Z.DROPDOWN,
            background: 'var(--color-surface)',
            borderRadius: RADIUS.XL,
            overflow: 'hidden',
            padding: '2px 0',
            minWidth: 160,
            boxShadow: SHADOW.LG,
          }}
        >
          {ALL_STATUSES.map((s) => {
            const active = statusFilter.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className="flex items-center gap-2 w-full text-left transition-colors cursor-pointer hover:bg-(--color-hover-row)"
                style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text)', border: 'none', background: 'transparent' }}
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-(--color-border) shrink-0"
                  style={{ background: active ? 'var(--color-accent)' : 'transparent' }}
                />
                <span className={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div className="sticky top-0 bg-(--color-panel) border-b border-(--color-border)" style={{ zIndex: Z.HEADER }}>
        <div className="flex items-center h-8">
          <div className={`grid ${cols} items-center h-8 text-(--color-text-muted) pl-4`} style={{ width: '70%' }}>
            <div className="px-3 text-center">Status</div>
            <div className="px-3 text-center">Condition</div>
            <div className="px-3 text-center">Trigger</div>
            <div className="px-3 text-center">TF</div>
            <div className="px-3 text-center">Order</div>
            <div className="px-3 text-center">Symbol</div>
            <div className="px-3 text-center">Bracket</div>
            <div className="px-3 text-center"></div>
          </div>
          <div className="ml-auto flex items-center gap-2" style={{ paddingRight: 16 }}>
            {statusFilterEl}
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={conditionPreview}
                onChange={(e) => setConditionPreview(e.target.checked)}
                className="accent-(--color-accent) w-3 h-3 cursor-pointer"
              />
              <span className={`text-[11px] transition-colors ${conditionPreview ? 'text-(--color-text)' : 'text-(--color-text-muted)'}`}>
                Preview
              </span>
            </label>
            <button
              onClick={() => openConditionModal()}
              style={{ padding: '4px 10px' }}
              className="text-xs rounded border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-hover-row) hover:text-(--color-text) hover:border-(--color-text-dim) transition-colors cursor-pointer"
            >
              + New
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {conditions.length === 0 && (
        <div className="flex items-center justify-center text-(--color-text-dim) text-xs" style={{ height: 120 }}>
          No conditions
        </div>
      )}

      {/* Rows */}
      {conditions.length > 0 && filteredConditions.length === 0 && (
        <div className="flex items-center justify-center text-(--color-text-dim) text-xs" style={{ height: 60 }}>
          No conditions match filter
        </div>
      )}
      {filteredConditions.map((c, i) => {
        const stripe = i % 2 === 1 ? TABLE_ROW_STRIPE : '';
        const isBuy = c.orderSide === 'buy';
        const condLabel = c.conditionType === 'closes_above' ? 'Close Above' : 'Close Below';
        const orderLabel = `${isBuy ? 'Buy' : 'Sell'} ${c.orderSize} ${c.orderType === 'market' ? 'MKT' : `LMT ${c.orderPrice?.toFixed(2) ?? ''}`}`;

        return (
          <div key={c.id} className={`${stripe} row-hover`}>
            <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '70%' }}>
              {/* Status */}
              <div className={`px-3 text-center ${STATUS_COLORS[c.status] ?? 'text-(--color-text-muted)'}`}>
                {STATUS_LABELS[c.status] ?? c.status}
              </div>

              {/* Condition type */}
              <div className="px-3 text-center text-(--color-text)">{condLabel}</div>

              {/* Trigger price */}
              <div className="px-3 text-center text-(--color-text)">{c.triggerPrice.toFixed(2)}</div>

              {/* Timeframe */}
              <div className="px-3 text-center text-(--color-text-medium)">{c.timeframe}</div>

              {/* Order */}
              <div className="px-3 text-center whitespace-nowrap">
                <span className={isBuy ? 'text-(--color-buy)' : 'text-(--color-sell)'}>{orderLabel}</span>
              </div>

              {/* Symbol */}
              <div className="px-3 text-center text-(--color-text)">{shortSymbol(c.contractId)}</div>

              {/* Bracket */}
              <div className="px-3 text-center text-(--color-text-muted)">
                {c.bracket?.enabled ? 'Yes' : '\u2014'}
              </div>

              {/* Actions */}
              <div className="px-3 flex items-center justify-center gap-1">
                {(c.status === 'armed' || c.status === 'paused') && (
                  <>
                    <button
                      onClick={() => handlePauseResume(c)}
                      disabled={actionId === c.id}
                      className="flex items-center justify-center rounded-full text-(--color-text-muted) opacity-70 hover:opacity-100 hover:text-(--color-text) hover:bg-(--color-border)/30 transition-all disabled:opacity-50"
                      style={{ width: 22, height: 22 }}
                      title={c.status === 'armed' ? 'Pause' : 'Resume'}
                    >
                      {c.status === 'armed' ? '\u23F8' : '\u25B6'}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={actionId === c.id}
                      className="flex items-center justify-center rounded-full text-(--color-sell) opacity-60 hover:opacity-100 hover:bg-(--color-border)/30 transition-all disabled:opacity-50"
                      style={{ width: 22, height: 22 }}
                      title="Delete"
                    >
                      {actionId === c.id ? '\u2026' : '\u2715'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
