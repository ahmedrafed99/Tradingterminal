import { useState, useEffect, useRef } from 'react';
import { consoleBuffer } from '../../services/monitor/consoleBuffer';
import type { ConsoleEntry, ConsoleTab } from '../../services/monitor/types';
import { FONT_SIZE, RADIUS } from '../../constants/layout';

type MarketSubTab = 'all' | 'quotes' | 'trades' | 'depth';

interface Props {
  onClose: () => void;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'market-hub', label: 'Market Hub' },
  { id: 'user-hub',   label: 'User Hub' },
  { id: 'api',        label: 'API' },
];

const MARKET_SUB_TABS: { id: MarketSubTab; label: string; kinds?: string[] }[] = [
  { id: 'all',    label: 'All' },
  { id: 'quotes', label: 'Quotes', kinds: ['QUOTE'] },
  { id: 'trades', label: 'Trades', kinds: ['TRADE'] },
  { id: 'depth',  label: 'Depth',  kinds: ['DEPTH'] },
];

const KIND_COLOR: Record<string, string> = {
  QUOTE: 'var(--color-text-dim)',
  TRADE: 'var(--color-buy)',
  DEPTH: 'var(--color-warning)',
  ORDER: 'var(--color-warning)',
  POS:   'var(--color-text-muted)',
  STATE: 'var(--color-text-bright)',
  POST:  'var(--color-text)',
  GET:   'var(--color-text)',
  PATCH: 'var(--color-text)',
  DELETE:'var(--color-sell)',
  PUT:   'var(--color-text)',
};

function pad2(n: number) { return n.toString().padStart(2, '0'); }
function pad3(n: number) { return n.toString().padStart(3, '0'); }

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

function EntryRow({ entry }: { entry: ConsoleEntry }) {
  const kindColor = KIND_COLOR[entry.kind] ?? 'var(--color-text-muted)';
  const textColor = entry.ok === false ? 'var(--color-sell)' : 'var(--color-text)';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '1px 0', lineHeight: 1.6 }}>
      <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, userSelect: 'none' }}>
        {formatTs(entry.ts)}
      </span>
      <span style={{ color: kindColor, width: 46, flexShrink: 0, fontWeight: 600 }}>
        {entry.kind}
      </span>
      <span style={{ color: textColor, wordBreak: 'break-all' }}>
        {entry.text}
      </span>
    </div>
  );
}

export function ConsolePanel({ onClose, activeTab, onTabChange }: Props) {
  const [allEntries, setAllEntries] = useState<ConsoleEntry[]>([]);
  const [marketSubTab, setMarketSubTab] = useState<MarketSubTab>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    setAllEntries(consoleBuffer.getEntries(activeTab));
    return consoleBuffer.subscribe(() => {
      setAllEntries([...consoleBuffer.getEntries(activeTab)]);
    });
  }, [activeTab]);

  const subTabDef = MARKET_SUB_TABS.find(s => s.id === marketSubTab);
  const entries = activeTab === 'market-hub' && subTabDef?.kinds
    ? allEntries.filter(e => subTabDef.kinds!.includes(e.kind))
    : allEntries;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: RADIUS.XL,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 8px',
        gap: 2,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              padding: '7px 10px',
              fontSize: FONT_SIZE.BASE,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-buy)' : '2px solid transparent',
              transition: 'color var(--transition-fast), border-color var(--transition-fast)',
            }}
            className={activeTab !== tab.id ? 'hover:text-(--color-text)' : ''}
          >
            {tab.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => consoleBuffer.clear(activeTab)}
          className="text-(--color-text-dim) hover:text-(--color-text-muted) transition-colors cursor-pointer"
          style={{
            background: 'none',
            border: 'none',
            fontSize: FONT_SIZE.SM,
            padding: '4px 8px',
          }}
        >
          Clear
        </button>
        <button
          onClick={onClose}
          className="text-(--color-text-dim) hover:text-(--color-text) transition-colors cursor-pointer"
          style={{
            background: 'none',
            border: 'none',
            fontSize: FONT_SIZE.LG,
            padding: '4px 8px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Market Hub sub-tabs */}
      {activeTab === 'market-hub' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}>
          {MARKET_SUB_TABS.map(sub => (
            <button
              key={sub.id}
              onClick={() => setMarketSubTab(sub.id)}
              style={{
                background: marketSubTab === sub.id ? 'var(--color-hover-row)' : 'none',
                border: '1px solid',
                borderColor: marketSubTab === sub.id ? 'var(--color-border)' : 'transparent',
                borderRadius: RADIUS.LG,
                padding: '2px 8px',
                fontSize: FONT_SIZE.SM,
                fontWeight: marketSubTab === sub.id ? 600 : 400,
                color: marketSubTab === sub.id ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast)',
              }}
              className={marketSubTab !== sub.id ? 'hover:text-(--color-text)' : ''}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          height: 220,
          overflowY: 'auto',
          padding: '6px 12px',
          fontFamily: 'var(--font-family-mono)',
          fontSize: FONT_SIZE.SM,
        }}
      >
        {entries.length === 0 ? (
          <div style={{ color: 'var(--color-text-dim)', padding: '8px 0' }}>No events yet.</div>
        ) : (
          entries.map(e => <EntryRow key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}
