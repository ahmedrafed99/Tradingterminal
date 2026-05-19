import { useState, useEffect, useRef } from 'react';
import { RADIUS, SHADOW, Z } from '../../constants/layout';

export interface SymbolItem {
  key: string;
  name: string;
  exchange: string;
  description?: string;
}

interface Props {
  items: SymbolItem[];
  selectedKey?: string;
  onSelect: (item: SymbolItem) => void;
  onClose: () => void;
  emptyMessage?: string;
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function SymbolPickerModal({ items, selectedKey, onSelect, onClose, emptyMessage }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const filtered = query.trim()
    ? items.filter((i) =>
        i.name.toLowerCase().includes(query.toLowerCase()) ||
        i.exchange.toLowerCase().includes(query.toLowerCase()),
      )
    : items;

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: Z.MODAL }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl"
        style={{
          zIndex: Z.MODAL, boxShadow: SHADOW.XL,
          width: 620, top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          display: 'flex', flexDirection: 'column', maxHeight: '90vh', minHeight: 360,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 14px', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>Symbol search</span>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: RADIUS.MD,
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-muted)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover-row)'; e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '0 20px 12px' }}>
          <div
            className="flex items-center gap-2 bg-(--color-input) border border-(--color-border) focus-within:border-(--color-text-dim) transition-colors"
            style={{ padding: '8px 12px', borderRadius: RADIUS.XL }}
          >
            <SearchIcon />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol..."
              className="bg-transparent border-none text-sm flex-1 focus:outline-none placeholder-(--color-text-muted)"
              style={{ color: 'var(--color-text)' }}
            />
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

        {/* List */}
        <div className="overflow-y-auto" style={{ flex: 1, padding: '6px 12px 10px' }}>
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-sm text-(--color-text-muted) text-center">
              {query ? 'No results' : (emptyMessage ?? 'No symbols available')}
            </div>
          )}
          {filtered.map((item) => {
            const active = item.key === selectedKey;
            return (
              <div
                key={item.key}
                className={`flex items-center hover:bg-(--color-hover-row) transition-colors cursor-pointer ${active ? 'bg-(--color-hover-row)' : ''}`}
                style={{ padding: '10px 12px', borderRadius: RADIUS.LG }}
                onClick={() => { onSelect(item); onClose(); }}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${active ? 'text-(--color-warning)' : 'text-(--color-text)'}`}>
                    {item.name}
                  </div>
                  {item.description && (
                    <div className="text-xs text-(--color-text-muted) truncate">{item.description}</div>
                  )}
                </div>
                <div className="text-xs text-(--color-text-muted)" style={{ marginLeft: 12, flexShrink: 0 }}>
                  {item.exchange}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
