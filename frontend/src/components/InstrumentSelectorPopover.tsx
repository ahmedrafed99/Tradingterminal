import { useState, useEffect, useRef } from 'react';
import type { Contract } from '../services/marketDataService';
import { useStore } from '../store/useStore';
import { useInstrumentSearch } from '../hooks/useInstrumentSearch';
import { useClickOutside } from '../hooks/useClickOutside';

const CATEGORIES = [
  { id: 'futures',    label: 'Futures',    exchanges: ['ProjectX'], disabled: false },
  { id: 'perpetuals', label: 'Perpetuals', exchanges: [] as string[], disabled: true },
  { id: 'spot',       label: 'Spot',       exchanges: [] as string[], disabled: true },
  { id: 'stocks',     label: 'Stocks',     exchanges: [] as string[], disabled: true },
  { id: 'cfd',        label: 'CFD',        exchanges: [] as string[], disabled: true },
] as const;

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-(--color-text-muted)">
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

      {/* Popover */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-black border border-(--color-border) rounded-lg shadow-lg z-50 animate-dropdown-in"
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.5)', width: 380 }}
        >
          {/* Search input */}
          <div style={{ padding: '10px 12px 0' }}>
            <div className="flex items-center gap-2 bg-(--color-input) rounded-md border border-(--color-border) transition-colors focus-within:border-(--color-text-dim)"
              style={{ padding: '6px 10px' }}
            >
              <SearchIcon />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search instrument..."
                className="bg-transparent border-none text-xs text-white flex-1 focus:outline-none placeholder-(--color-text-muted)"
              />
            </div>
          </div>

          {/* Category filter row */}
          <div className="flex items-center gap-1" style={{ padding: '8px 12px 0' }}>
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
                className={`text-[11px] font-medium rounded-md transition-colors ${
                  cat.disabled
                    ? 'opacity-50 cursor-default'
                    : cat.id === activeCategory
                      ? 'text-white bg-(--color-surface)'
                      : 'text-(--color-text-muted) hover:text-(--color-text)'
                }`}
                style={{ padding: '4px 8px' }}
                title={cat.disabled ? 'Coming soon' : undefined}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Exchange filter row */}
          {exchanges.length > 0 && (
            <div className="flex items-center gap-1" style={{ padding: '6px 12px 0' }}>
              {exchanges.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setActiveExchange(ex)}
                  className={`text-[11px] font-medium rounded-md transition-colors ${
                    ex === activeExchange
                      ? 'text-white bg-(--color-surface)'
                      : 'text-(--color-text-muted) hover:text-(--color-text)'
                  }`}
                  style={{ padding: '3px 8px' }}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-(--color-border) mx-3" style={{ marginTop: 8 }} />

          {/* Results list */}
          <div className="overflow-y-auto" style={{ maxHeight: 280, padding: '4px 6px 6px' }}>
            {searching && results.length === 0 && (
              <div className="px-3 py-4 text-xs text-(--color-text-muted) text-center">Searching...</div>
            )}
            {showingSearch && !searching && results.length === 0 && (
              <div className="px-3 py-4 text-xs text-(--color-text-muted) text-center">No results</div>
            )}
            {!showingSearch && bookmarks.length === 0 && (
              <div className="px-3 py-4 text-xs text-(--color-text-muted) text-center">
                Type to search instruments
              </div>
            )}

            {displayList.map((c) => {
              const active = contract?.id === c.id;
              const bookmarked = isBookmarked(c);
              return (
                <div
                  key={c.id}
                  className={`flex items-center hover:bg-(--color-surface) transition-colors rounded-md cursor-pointer ${
                    active ? 'bg-(--color-surface)' : ''
                  }`}
                  style={{ padding: '8px 10px' }}
                  onClick={() => handleSelect(c)}
                >
                  <button
                    onClick={(e) => toggleBookmark(c, e)}
                    className="p-0.5 hover:opacity-80 transition-opacity"
                    style={{ marginRight: 10 }}
                  >
                    <StarIcon filled={bookmarked} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium ${active ? 'text-(--color-warning)' : 'text-(--color-text)'}`}>
                      {c.name}
                    </div>
                    <div className="text-[10px] text-(--color-text-muted) truncate">{c.description}</div>
                    <div className="text-[10px] text-(--color-text-muted)">
                      {currentCategory?.label ?? 'Futures'} · {activeExchange || 'ProjectX'}
                    </div>
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
