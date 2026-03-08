import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { conditionService } from '../../services/conditionService';
import type { Condition } from '../../services/conditionService';

function shortSymbol(contractId: string): string {
  const parts = contractId.split('.');
  if (parts.length >= 5) {
    const sym = parts[3];
    const expiry = parts[4];
    return sym + expiry.charAt(0) + expiry.slice(-1);
  }
  return contractId;
}

const ALL_STATUSES = ['armed', 'paused', 'triggered', 'failed', 'expired'] as const;
type ConditionStatus = (typeof ALL_STATUSES)[number];

const STATUS_COLORS: Record<string, string> = {
  armed: 'text-[#26a69a]',
  paused: 'text-[#787b86]',
  triggered: 'text-[#2962ff]',
  failed: 'text-[#ef5350]',
  expired: 'text-[#787b86]',
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
  const serverUrl = useStore((s) => s.conditionServerUrl);
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

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

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

  // SSE connection
  useEffect(() => {
    if (!serverUrl) return;

    // Initial fetch
    conditionService.getAll(serverUrl).then(setConditions).catch(() => {});

    // SSE stream
    const es = conditionService.subscribe(serverUrl, {
      onSnapshot: setConditions,
      onTriggered: (c) => {
        upsertCondition(c);
        addToast({ type: 'success', message: `Condition triggered: ${c.conditionType} ${c.triggerPrice}` });
      },
      onFailed: (c) => {
        upsertCondition(c);
        addToast({ type: 'error', message: `Condition failed: ${c.errorMessage ?? 'Unknown'}` });
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
    if (!serverUrl) return;
    setActionId(condition.id);
    try {
      const updated =
        condition.status === 'armed'
          ? await conditionService.pause(serverUrl, condition.id)
          : await conditionService.resume(serverUrl, condition.id);
      upsertCondition(updated);
    } catch {
      // toast handled by SSE
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!serverUrl) return;
    setActionId(id);
    try {
      await conditionService.remove(serverUrl, id);
      removeCondition(id);
    } catch {
      // stay in list on failure
    } finally {
      setActionId(null);
    }
  }

  const toolbar = (
    <div className="flex items-center h-8 shrink-0 border-b border-[#2a2e39]">
      <div className="ml-auto flex items-center gap-3" style={{ paddingRight: 16 }}>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={conditionPreview}
            onChange={(e) => setConditionPreview(e.target.checked)}
            className="accent-[#2962ff] w-3 h-3 cursor-pointer"
          />
          <span className={`text-[11px] transition-colors ${conditionPreview ? 'text-[#d1d4dc]' : 'text-[#787b86]'}`}>
            Preview
          </span>
        </label>
        <button
          onClick={() => openConditionModal()}
          className="text-[11px] text-[#787b86] hover:text-[#d1d4dc] transition-colors cursor-pointer select-none"
          style={{ padding: '2px 8px' }}
        >
          + New
        </button>
      </div>
    </div>
  );

  if (!serverUrl) {
    return (
      <div className="flex items-center justify-center h-full text-[#434651] text-xs">
        Set a Condition Server URL in Settings to use conditional orders
      </div>
    );
  }

  const isFilterAll = statusFilter.size === ALL_STATUSES.length;
  const filterLabel = isFilterAll
    ? 'Status'
    : [...statusFilter].map((s) => STATUS_LABELS[s]).join(', ');

  const statusHeaderEl = (
    <div className="px-3 text-center relative" ref={filterRef}>
      <button
        onClick={() => setFilterOpen(!filterOpen)}
        className="cursor-pointer select-none hover:text-[#d1d4dc] transition-colors inline-flex items-center gap-1"
      >
        {filterLabel}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M1.5 3L4 5.5L6.5 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {filterOpen && (
        <div
          className="absolute left-1/2 top-full mt-1 border border-[#2a2e39] rounded-lg shadow-lg z-50"
          style={{ background: '#000', minWidth: 120, transform: 'translateX(-50%)' }}
        >
          {ALL_STATUSES.map((s) => {
            const active = statusFilter.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`flex items-center gap-2 w-full text-left text-xs hover:bg-[#2a2e39] transition-colors cursor-pointer ${
                  active ? 'text-[#d1d4dc]' : 'text-[#787b86]'
                }`}
                style={{ padding: '6px 12px' }}
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-[#2a2e39] shrink-0"
                  style={{ background: active ? '#2962ff' : 'transparent' }}
                />
                <span className={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (conditions.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {toolbar}
        <div className="flex items-center justify-center flex-1 text-[#434651] text-xs">
          No conditions
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black border-b border-[#2a2e39]">
        <div className="flex items-center h-8">
          <div className={`grid ${cols} items-center h-8 text-[#787b86] pl-4`} style={{ width: '85%' }}>
            {statusHeaderEl}
            <div className="px-3 text-center">Condition</div>
            <div className="px-3 text-center">Trigger</div>
            <div className="px-3 text-center">TF</div>
            <div className="px-3 text-center">Order</div>
            <div className="px-3 text-center">Symbol</div>
            <div className="px-3 text-center">Bracket</div>
            <div className="px-3 text-center"></div>
          </div>
          <div className="ml-auto flex items-center gap-3" style={{ paddingRight: 16 }}>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={conditionPreview}
                onChange={(e) => setConditionPreview(e.target.checked)}
                className="accent-[#2962ff] w-3 h-3 cursor-pointer"
              />
              <span className={`text-[11px] transition-colors ${conditionPreview ? 'text-[#d1d4dc]' : 'text-[#787b86]'}`}>
                Preview
              </span>
            </label>
            <button
              onClick={() => openConditionModal()}
              className="text-[11px] text-[#787b86] hover:text-[#d1d4dc] transition-colors cursor-pointer select-none"
              style={{ padding: '2px 8px' }}
            >
              + New
            </button>
          </div>
        </div>
      </div>

      {/* Rows */}
      {filteredConditions.length === 0 && (
        <div className="flex items-center justify-center text-[#434651] text-xs" style={{ height: 60 }}>
          No conditions match filter
        </div>
      )}
      {filteredConditions.map((c, i) => {
        const stripe = i % 2 === 1 ? 'bg-[#0d1117]/40' : '';
        const isBuy = c.orderSide === 'buy';
        const condLabel = c.conditionType === 'closes_above' ? 'Close Above' : 'Close Below';
        const orderLabel = `${isBuy ? 'Buy' : 'Sell'} ${c.orderSize} ${c.orderType === 'market' ? 'MKT' : `LMT ${c.orderPrice?.toFixed(2) ?? ''}`}`;

        return (
          <div key={c.id} className={`${stripe} hover:bg-[#1e222d]/50 transition-colors`}>
            <div className={`grid ${cols} items-center h-7 pl-4`} style={{ width: '85%' }}>
              {/* Status */}
              <div className={`px-3 text-center font-medium ${STATUS_COLORS[c.status] ?? 'text-[#787b86]'}`}>
                {c.status}
              </div>

              {/* Condition type */}
              <div className="px-3 text-center text-[#d1d4dc]">{condLabel}</div>

              {/* Trigger price */}
              <div className="px-3 text-center text-[#d1d4dc]">{c.triggerPrice.toFixed(2)}</div>

              {/* Timeframe */}
              <div className="px-3 text-center text-[#9598a1]">{c.timeframe}</div>

              {/* Order */}
              <div className="px-3 text-center whitespace-nowrap">
                <span className={isBuy ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{orderLabel}</span>
              </div>

              {/* Symbol */}
              <div className="px-3 text-center text-[#9598a1]">{shortSymbol(c.contractId)}</div>

              {/* Bracket */}
              <div className="px-3 text-center text-[#787b86]">
                {c.bracket?.enabled ? 'Yes' : '\u2014'}
              </div>

              {/* Actions */}
              <div className="px-3 text-center flex items-center justify-center gap-2">
                {(c.status === 'armed' || c.status === 'paused') && (
                  <>
                    <button
                      onClick={() => handlePauseResume(c)}
                      disabled={actionId === c.id}
                      className="text-[#787b86] hover:text-[#d1d4dc] transition-colors disabled:opacity-50"
                      title={c.status === 'armed' ? 'Pause' : 'Resume'}
                    >
                      {c.status === 'armed' ? '\u23F8' : '\u25B6'}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={actionId === c.id}
                      className="text-[#ef5350] hover:bg-[#ef5350]/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      {actionId === c.id ? '...' : '\u2715'}
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
