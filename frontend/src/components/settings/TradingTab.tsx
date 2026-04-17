import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { useInstrumentSearch } from '../../hooks/useInstrumentSearch';
import { useClickOutside } from '../../hooks/useClickOutside';
import { showToast } from '../../utils/toast';
import { SHADOW, Z } from '../../constants/layout';
import type { Contract } from '../../services/marketDataService';

const SECTION_TITLE = 'text-xs font-medium text-(--color-text) uppercase tracking-wider';

export function TradingTab() {
  const { blacklistedSymbols, addToBlacklist, removeFromBlacklist, clearBlacklist } = useStore(
    useShallow((s) => ({
      blacklistedSymbols: s.blacklistedSymbols,
      addToBlacklist: s.addToBlacklist,
      removeFromBlacklist: s.removeFromBlacklist,
      clearBlacklist: s.clearBlacklist,
    })),
  );

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const { query, setQuery, searching, results, showingSearch, displayList } = useInstrumentSearch();

  useClickOutside(searchRef, true, () => setDropdownOpen(false));

  function handleAdd(c: Contract) {
    const sym = c.name.replace(/[A-Z]\d+$/i, '');
    if (blacklistedSymbols.includes(sym)) {
      showToast('info', `${sym} already blocked`);
    } else {
      addToBlacklist(sym);
      showToast('warning', `${sym} blocked`, 'Orders on this symbol are now disabled.');
    }
    setQuery('');
    setDropdownOpen(false);
  }

  function handleRemove(sym: string) {
    removeFromBlacklist(sym);
    showToast('success', `${sym} unblocked`, 'Orders on this symbol are re-enabled.');
  }

  function handleClearAll() {
    clearBlacklist();
    showToast('success', 'All symbols unblocked');
  }

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── BLACKLIST SECTION ── */}
        <div>
          <div className={SECTION_TITLE} style={{ marginBottom: 10 }}>Symbol Blacklist</div>
          <p className="text-[11px] text-(--color-text-muted)" style={{ marginBottom: 14 }}>
            Blocked symbols cannot be traded. They can still be viewed on charts.
          </p>

          {/* Search / add */}
          <div ref={searchRef} className="relative" style={{ marginBottom: 16 }}>
            <input
              type="text"
              value={query}
              placeholder="Search symbol to block..."
              className="w-full bg-(--color-input) border border-(--color-border) rounded-lg text-xs text-(--color-text-bright) placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-warning)/50 transition-all"
              style={{ padding: '7px 12px' }}
              onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
            />

            {dropdownOpen && (showingSearch || searching) && (
              <div
                className="absolute left-0 right-0 top-full mt-1 bg-(--color-panel) border border-(--color-border) rounded-lg py-1 overflow-y-auto animate-dropdown-in"
                style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.XL, maxHeight: 180 }}
              >
                {searching && (
                  <div className="px-3 py-2 text-xs text-(--color-text-muted) text-center">Searching...</div>
                )}
                {!searching && results.length === 0 && showingSearch && (
                  <div className="px-3 py-2 text-xs text-(--color-text-muted) text-center">No results</div>
                )}
                {displayList.map((c) => {
                  const sym = c.name.replace(/[A-Z]\d+$/i, '');
                  const alreadyBlocked = blacklistedSymbols.includes(sym);
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 mx-1.5 rounded-md transition-colors ${
                        alreadyBlocked
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-(--color-hover-row) cursor-pointer'
                      }`}
                      style={{ padding: '7px 10px' }}
                      onClick={() => !alreadyBlocked && handleAdd(c)}
                    >
                      <div className="flex-1">
                        <span className="text-sm font-medium text-(--color-text)">{c.name}</span>
                        <span className="text-[11px] text-(--color-text-muted)" style={{ marginLeft: 6 }}>{c.description}</span>
                      </div>
                      {alreadyBlocked && (
                        <span className="text-[11px] text-(--color-warning)">blocked</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Blocked list */}
          {blacklistedSymbols.length === 0 ? (
            <p className="text-xs text-(--color-text-muted) text-center" style={{ padding: '12px 0' }}>
              No symbols blocked — orders can be placed on any symbol.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {blacklistedSymbols.map((sym) => (
                <div
                  key={sym}
                  className="flex items-center justify-between rounded-md border border-(--color-warning)/25 transition-colors"
                  style={{ padding: '7px 12px', background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)' }}
                >
                  <span className="text-sm font-medium text-(--color-warning)">{sym}</span>
                  <button
                    onClick={() => handleRemove(sym)}
                    className="text-[11px] text-(--color-text-muted) hover:text-(--color-error) transition-colors"
                    title={`Unblock ${sym}`}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                onClick={handleClearAll}
                className="text-[11px] text-(--color-text-muted) hover:text-(--color-error) transition-colors text-right self-end"
                style={{ marginTop: 4 }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
