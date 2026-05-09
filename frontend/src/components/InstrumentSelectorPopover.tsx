import { useState, useEffect, useRef } from 'react';
import type { Contract } from '../services/marketDataService';
import { useStore } from '../store/useStore';
import { useInstrumentSearch } from '../hooks/useInstrumentSearch';
import { useClickOutside } from '../hooks/useClickOutside';
import { RADIUS, SHADOW, Z } from '../constants/layout';

const EXCHANGE_LOGOS: Record<string, string> = {
  ProjectX: 'https://s2fassets.s3.us-east-1.amazonaws.com/projectx-login.png',
};

const CATEGORIES = [
  { id: 'futures',    label: 'Futures',    exchanges: ['ProjectX'], disabled: false },
  { id: 'perpetuals', label: 'Perpetuals', exchanges: [] as string[], disabled: true },
  { id: 'spot',       label: 'Spot',       exchanges: [] as string[], disabled: true },
  { id: 'stocks',     label: 'Stocks',     exchanges: [] as string[], disabled: true },
  { id: 'cfd',        label: 'CFD',        exchanges: [] as string[], disabled: true },
] as const;

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-(--color-text-muted)">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function InstrumentSelectorPopover() {
  const contract = useStore((s) =>
    s.selectedChart === 'left' ? s.contract : s.secondContract,
  );
  const setContract = useStore((s) =>
    s.selectedChart === 'left' ? s.setContract : s.setSecondContract,
  );

  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('futures');
  const [activeExchange, setActiveExchange] = useState<string>('ProjectX');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    query, setQuery, searching, results,
    showingSearch, displayList, bookmarks,
    isBookmarked, toggleBookmark,
  } = useInstrumentSearch();

  useClickOutside(containerRef, open, () => setOpen(false));

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [open, setQuery]);

  function handleSelect(c: Contract) {
    setContract(c);
    setQuery('');
    setOpen(false);
  }

  const currentCategory = CATEGORIES.find((c) => c.id === activeCategory);
  const exchanges = currentCategory?.exchanges ?? [];

  return (
    <div ref={containerRef} className="relative" style={{ marginLeft: '8px' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 hover:bg-(--color-surface)/50 rounded transition-colors"
        style={{ padding: '4px 8px' }}
      >
        <span className="text-xs font-medium text-(--color-text)">
          {contract?.name ?? 'Select'}
        </span>
<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
          <path d="M2.5 3.75L5 6.25L7.5 3.75" />
        </svg>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg"
          style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.XL, width: 620, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', minHeight: 560 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 14px', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>Symbol search</span>
            <button
              onClick={() => setOpen(false)}
              className="focus:outline-none"
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

          {/* Search input */}
          <div style={{ padding: '0 20px 12px' }}>
            <div className="flex items-center gap-2 bg-(--color-input) border border-(--color-border) transition-colors focus-within:border-(--color-text-dim)"
              style={{ padding: '8px 12px', borderRadius: RADIUS.XL }}
            >
              <SearchIcon />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search instrument..."
                className="bg-transparent border-none text-sm text-white flex-1 focus:outline-none placeholder-(--color-text-muted)"
              />
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

          {/* Category filter row */}
          <div className="flex items-center gap-1" style={{ padding: '10px 20px 0' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  if (cat.disabled) return;
                  setActiveCategory(cat.id);
                  const exs = cat.exchanges;
                  setActiveExchange(exs.length > 0 ? exs[0] : '');
                }}
                disabled={cat.disabled}
                className={`text-xs font-medium transition-colors ${
                  cat.disabled
                    ? 'opacity-40 cursor-default'
                    : cat.id === activeCategory
                      ? 'text-white bg-(--color-border)'
                      : 'text-(--color-text-muted) hover:text-(--color-text)'
                }`}
                style={{ padding: '4px 10px', borderRadius: RADIUS.XL, border: 'none', cursor: cat.disabled ? 'default' : 'pointer', background: cat.id === activeCategory ? 'var(--color-border)' : 'transparent' }}
                title={cat.disabled ? 'Coming soon' : undefined}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Exchange filter row */}
          {exchanges.length > 0 && (
            <div className="flex items-center gap-1" style={{ padding: '6px 20px 0' }}>
              {exchanges.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setActiveExchange(ex)}
                  className={`text-xs font-medium transition-colors ${
                    ex === activeExchange ? 'text-white' : 'text-(--color-text-muted) hover:text-(--color-text)'
                  }`}
                  style={{ padding: '3px 10px', borderRadius: RADIUS.XL, border: 'none', cursor: 'pointer', background: ex === activeExchange ? 'var(--color-border)' : 'transparent', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  {EXCHANGE_LOGOS[ex] && <img src={EXCHANGE_LOGOS[ex]} alt={ex} style={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 2 }} />}
                  {ex}
                </button>
              ))}
            </div>
          )}

          <div style={{ height: 8 }} />
          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 5%' }} />

          {/* Results list */}
          <div className="overflow-y-auto" style={{ flex: 1, padding: '6px 12px 10px' }}>
            {searching && results.length === 0 && (
              <div className="px-3 py-6 text-sm text-(--color-text-muted) text-center">Searching...</div>
            )}
            {showingSearch && !searching && results.length === 0 && (
              <div className="px-3 py-6 text-sm text-(--color-text-muted) text-center">No results</div>
            )}
            {!showingSearch && bookmarks.length === 0 && (
              <div className="px-3 py-6 text-sm text-(--color-text-muted) text-center">Type to search instruments</div>
            )}
            {displayList.map((c) => {
              const active = contract?.id === c.id;
              const bookmarked = isBookmarked(c);
              return (
                <div
                  key={c.id}
                  className={`flex items-center hover:bg-(--color-hover-row) transition-colors cursor-pointer ${active ? 'bg-(--color-hover-row)' : ''}`}
                  style={{ padding: '10px 12px', borderRadius: RADIUS.LG }}
                  onClick={() => handleSelect(c)}
                >
                  <button
                    onClick={(e) => toggleBookmark(c, e)}
                    className="p-0.5 hover:opacity-80 transition-opacity"
                    style={{ marginRight: 12, background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <StarIcon filled={bookmarked} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${active ? 'text-(--color-warning)' : 'text-(--color-text)'}`}>
                      {c.name}
                    </div>
                    <div className="text-xs text-(--color-text-muted) truncate">{c.description}</div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-(--color-text-muted)" style={{ marginLeft: 12, flexShrink: 0 }}>
                    <span>{currentCategory?.label ?? 'Futures'} · {activeExchange || 'ProjectX'}</span>
                    {EXCHANGE_LOGOS[activeExchange] && <img src={EXCHANGE_LOGOS[activeExchange]} alt={activeExchange} style={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 2 }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
