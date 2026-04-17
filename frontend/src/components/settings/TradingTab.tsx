import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { useInstrumentSearch } from '../../hooks/useInstrumentSearch';
import { useClickOutside } from '../../hooks/useClickOutside';
import { showToast } from '../../utils/toast';
import { SHADOW, Z } from '../../constants/layout';
import type { Contract } from '../../services/marketDataService';

const SECTION_TITLE = 'text-xs font-medium text-(--color-text) uppercase tracking-wider';

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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const { query, setQuery, searching, results, showingSearch, displayList } = useInstrumentSearch();

  useClickOutside(searchRef, true, () => setDropdownOpen(false));

  // All symbols blocked in any scope
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
    const alreadyExists = blacklist.global.includes(sym) ||
      Object.values(blacklist.accounts).some((arr) => arr.includes(sym));
    if (alreadyExists) {
      showToast('info', `${sym} already blocked`);
    } else {
      // Block on active account by default; fall back to global if no account
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
    removeSymbolFromAll(sym);
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
            Blocked symbols cannot be traded. Global blocks all accounts; per-account blocks only that account.
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

          {/* Matrix table */}
          {!hasAny ? (
            <p className="text-xs text-(--color-text-muted) text-center" style={{ padding: '12px 0' }}>
              No symbols blocked — orders can be placed on any symbol.
            </p>
          ) : (
            <div>
              <div className="overflow-x-auto rounded-lg border border-(--color-border)">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="border-b border-(--color-border)" style={{ background: 'var(--color-surface)' }}>
                      <th className="text-left text-[11px] font-medium text-(--color-text-muted)" style={{ padding: '7px 12px', minWidth: 72 }}>
                        Symbol
                      </th>
                      <th className="text-center text-[11px] font-medium text-(--color-text-muted)" style={{ padding: '7px 10px', minWidth: 64 }}>
                        Global
                      </th>
                      {accounts.map((acc) => (
                        <th
                          key={acc.id}
                          className="text-center text-[11px] font-medium text-(--color-text-muted)"
                          style={{ padding: '7px 10px', minWidth: 90, maxWidth: 120 }}
                          title={acc.name}
                        >
                          <span
                            className="block overflow-hidden text-ellipsis whitespace-nowrap"
                            style={{ maxWidth: 110 }}
                          >
                            {acc.name}
                          </span>
                        </th>
                      ))}
                      <th style={{ width: 32 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {allSymbols.map((sym) => (
                      <tr
                        key={sym}
                        className="border-b border-(--color-border)/40 transition-colors"
                        style={{
                          background: hoveredRow === sym
                            ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)'
                            : undefined,
                        }}
                        onMouseEnter={() => setHoveredRow(sym)}
                        onMouseLeave={() => setHoveredRow(null)}
                      >
                        <td style={{ padding: '7px 12px' }}>
                          <span className="text-sm font-medium text-(--color-warning)">{sym}</span>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={blacklist.global.includes(sym)}
                            onChange={() => toggleGlobal(sym)}
                            className="cursor-pointer accent-(--color-warning)"
                          />
                        </td>
                        {accounts.map((acc) => (
                          <td key={acc.id} style={{ padding: '7px 10px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={(blacklist.accounts[acc.id] ?? []).includes(sym)}
                              onChange={() => toggleAccount(sym, acc.id)}
                              className="cursor-pointer accent-(--color-warning)"
                            />
                          </td>
                        ))}
                        <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                          <button
                            onClick={() => handleRemoveRow(sym)}
                            className="text-[11px] text-(--color-text-dim) hover:text-(--color-error) transition-colors"
                            style={{ opacity: hoveredRow === sym ? 1 : 0, transition: 'opacity var(--transition-fast)' }}
                            title={`Remove ${sym}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleClearAll}
                className="text-[11px] text-(--color-text-muted) hover:text-(--color-error) transition-colors text-right self-end"
                style={{ marginTop: 8, display: 'block', marginLeft: 'auto' }}
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
