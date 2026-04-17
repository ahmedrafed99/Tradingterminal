import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { useInstrumentSearch } from '../../hooks/useInstrumentSearch';
import { useClickOutside } from '../../hooks/useClickOutside';
import { showToast } from '../../utils/toast';
import { SHADOW, Z } from '../../constants/layout';
import type { Contract } from '../../services/marketDataService';

const SECTION_TITLE = 'text-xs font-medium text-(--color-text) uppercase tracking-wider';

function scopeLabel(sym: string, global: string[], accounts: Record<string, string[]>, accountCount: number): string {
  const inGlobal = global.includes(sym);
  const accountMatches = Object.values(accounts).filter((arr) => arr.includes(sym)).length;

  if (inGlobal && accountMatches === 0) return 'Global only';
  if (inGlobal && accountMatches === accountCount && accountCount > 0) return 'All accounts';
  if (inGlobal && accountMatches > 0) return `Global + ${accountMatches} account${accountMatches > 1 ? 's' : ''}`;
  if (!inGlobal && accountMatches > 0) return `${accountMatches} account${accountMatches > 1 ? 's' : ''}`;
  return 'Not blocked';
}

export function TradingTab() {
  const {
    blacklist,
    accounts,
    activeAccountId,
    setBlacklistGlobal,
    setBlacklistAccount,
    removeSymbolFromAll,
    clearBlacklist,
  } = useStore(
    useShallow((s) => ({
      blacklist: s.blacklist,
      accounts: s.accounts,
      activeAccountId: s.activeAccountId,
      setBlacklistGlobal: s.setBlacklistGlobal,
      setBlacklistAccount: s.setBlacklistAccount,
      removeSymbolFromAll: s.removeSymbolFromAll,
      clearBlacklist: s.clearBlacklist,
    })),
  );

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [openScopeSym, setOpenScopeSym] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const scopeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { query, setQuery, searching, results, showingSearch, displayList } = useInstrumentSearch();

  useClickOutside(searchRef, true, () => setDropdownOpen(false));

  // Close scope dropdown when clicking outside it
  useClickOutside(
    { current: openScopeSym ? (scopeRefs.current[openScopeSym] ?? null) : null },
    true,
    () => setOpenScopeSym(null),
  );

  const allSymbols = useMemo(() => {
    const set = new Set([
      ...blacklist.global,
      ...Object.values(blacklist.accounts).flat(),
    ]);
    return [...set].sort();
  }, [blacklist]);

  const hasAny = allSymbols.length > 0;

  function handleAdd(c: Contract) {
    const sym = c.name.replace(/[A-Z]\d+$/i, '');
    const alreadyExists =
      blacklist.global.includes(sym) ||
      Object.values(blacklist.accounts).some((arr) => arr.includes(sym));
    if (alreadyExists) {
      showToast('info', `${sym} already blocked`);
    } else {
      if (activeAccountId) {
        const current = blacklist.accounts[activeAccountId] ?? [];
        setBlacklistAccount(activeAccountId, [...current, sym]);
      } else {
        setBlacklistGlobal([...blacklist.global, sym]);
      }
      showToast('warning', `${sym} blocked`, 'Orders on this symbol are now disabled.');
    }
    setQuery('');
    setDropdownOpen(false);
  }

  function toggleGlobal(sym: string) {
    const next = blacklist.global.includes(sym)
      ? blacklist.global.filter((s) => s !== sym)
      : [...blacklist.global, sym];
    setBlacklistGlobal(next);
  }

  function toggleAccount(sym: string, accountId: string) {
    const current = blacklist.accounts[accountId] ?? [];
    const next = current.includes(sym)
      ? current.filter((s) => s !== sym)
      : [...current, sym];
    setBlacklistAccount(accountId, next);
  }

  function handleRemoveRow(sym: string) {
    if (openScopeSym === sym) setOpenScopeSym(null);
    removeSymbolFromAll(sym);
    showToast('success', `${sym} unblocked`);
  }

  function handleClearAll() {
    setOpenScopeSym(null);
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
            Blocked symbols cannot be traded. Choose which accounts each block applies to.
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
                  const alreadyBlocked =
                    blacklist.global.includes(sym) ||
                    Object.values(blacklist.accounts).some((arr) => arr.includes(sym));
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
          {!hasAny ? (
            <p className="text-xs text-(--color-text-muted) text-center" style={{ padding: '12px 0' }}>
              No symbols blocked — orders can be placed on any symbol.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {allSymbols.map((sym) => {
                const isOpen = openScopeSym === sym;
                const label = scopeLabel(sym, blacklist.global, blacklist.accounts, accounts.length);

                return (
                  <div
                    key={sym}
                    ref={(el) => { scopeRefs.current[sym] = el; }}
                    className="relative"
                  >
                    {/* Row */}
                    <div
                      className="flex items-center gap-2 rounded-lg border border-(--color-warning)/20 transition-colors"
                      style={{
                        padding: '7px 10px',
                        background: 'color-mix(in srgb, var(--color-warning) 6%, transparent)',
                      }}
                    >
                      {/* Symbol name */}
                      <span className="text-sm font-semibold text-(--color-warning)" style={{ minWidth: 36 }}>
                        {sym}
                      </span>

                      {/* Scope dropdown trigger */}
                      <button
                        className="flex items-center gap-1.5 flex-1 rounded-md border border-(--color-border) bg-(--color-input) text-[11px] text-(--color-text-muted) hover:text-(--color-text) hover:border-(--color-border-bright) transition-colors"
                        style={{ padding: '4px 8px', justifyContent: 'space-between' }}
                        onClick={() => setOpenScopeSym(isOpen ? null : sym)}
                      >
                        <span>{label}</span>
                        <span style={{ opacity: 0.5, fontSize: 9 }}>{isOpen ? '▲' : '▼'}</span>
                      </button>

                      {/* Remove row */}
                      <button
                        onClick={() => handleRemoveRow(sym)}
                        className="text-[11px] text-(--color-text-dim) hover:text-(--color-error) transition-colors"
                        title={`Remove ${sym}`}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Scope dropdown panel */}
                    {isOpen && (
                      <div
                        className="absolute left-0 right-0 top-full mt-1 bg-(--color-panel) border border-(--color-border) rounded-lg py-1 animate-dropdown-in"
                        style={{ zIndex: Z.DROPDOWN, boxShadow: SHADOW.XL }}
                      >
                        {/* Global option */}
                        <label
                          className="flex items-center gap-2.5 mx-1 rounded-md hover:bg-(--color-hover-row) transition-colors cursor-pointer"
                          style={{ padding: '6px 10px' }}
                        >
                          <input
                            type="checkbox"
                            checked={blacklist.global.includes(sym)}
                            onChange={() => toggleGlobal(sym)}
                            className="cursor-pointer accent-(--color-warning)"
                          />
                          <span className="text-xs text-(--color-text)">Global</span>
                          <span className="text-[10px] text-(--color-text-muted)" style={{ marginLeft: 'auto' }}>all accounts</span>
                        </label>

                        {/* Per-account options */}
                        {accounts.length > 0 && (
                          <>
                            <div
                              className="border-t border-(--color-border)/50"
                              style={{ margin: '4px 0' }}
                            />
                            {accounts.map((acc) => (
                              <label
                                key={acc.id}
                                className="flex items-center gap-2.5 mx-1 rounded-md hover:bg-(--color-hover-row) transition-colors cursor-pointer"
                                style={{ padding: '6px 10px' }}
                              >
                                <input
                                  type="checkbox"
                                  checked={(blacklist.accounts[acc.id] ?? []).includes(sym)}
                                  onChange={() => toggleAccount(sym, acc.id)}
                                  className="cursor-pointer accent-(--color-warning)"
                                />
                                <span
                                  className="text-xs text-(--color-text) overflow-hidden text-ellipsis whitespace-nowrap"
                                  style={{ maxWidth: 180 }}
                                  title={acc.name}
                                >
                                  {acc.name}
                                </span>
                              </label>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={handleClearAll}
                className="text-[11px] text-(--color-text-muted) hover:text-(--color-error) transition-colors text-right self-end"
                style={{ marginTop: 6 }}
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
