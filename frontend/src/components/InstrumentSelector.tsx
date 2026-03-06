import { useState, useEffect, useRef, useCallback } from 'react';
import { marketDataService, type Contract } from '../services/marketDataService';
import { useStore } from '../store/useStore';

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#787b86]">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function InstrumentSelector({ fixed }: { fixed?: boolean }) {
  // fixed=true → order panel's own contract (independent); otherwise selection-aware (chart toolbar)
  const contract = useStore((s) =>
    fixed ? s.orderContract
      : s.selectedChart === 'left' ? s.contract : s.secondContract,
  );
  const setContract = useStore((s) =>
    fixed ? s.setOrderContract
      : s.selectedChart === 'left' ? s.setContract : s.setSecondContract,
  );
  const pinnedInstruments = useStore((s) => s.pinnedInstruments);
  const pinInstrument = useStore((s) => s.pinInstrument);
  const unpinInstrument = useStore((s) => s.unpinInstrument);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contract[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Contract[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve pinned instrument symbols to Contract objects
  useEffect(() => {
    if (pinnedInstruments.length === 0) {
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      pinnedInstruments.map((sym) =>
        marketDataService.searchContracts(sym).then((res) => res.find((c) => c.activeContract) ?? null),
      ),
    ).then((resolved) => {
      if (!cancelled) setBookmarks(resolved.filter((c): c is Contract => c !== null));
    });
    return () => { cancelled = true; };
  }, [pinnedInstruments]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setResults([]);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const contracts = await marketDataService.searchContracts(query);
        setResults(contracts.filter((c) => c.activeContract));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(c: Contract) {
    setContract(c);
    setQuery('');
    setOpen(false);
  }

  const isBookmarked = useCallback(
    (c: Contract) => pinnedInstruments.some((sym) => c.name.toUpperCase().startsWith(sym.toUpperCase())),
    [pinnedInstruments],
  );

  const toggleBookmark = useCallback(
    (c: Contract, e: React.MouseEvent) => {
      e.stopPropagation();
      // Extract the base symbol (e.g. "NQM6" → "NQ", "MNQM6" → "MNQ")
      const name = c.name;
      // Strip trailing month+year code (1 letter + digits)
      const sym = name.replace(/[A-Z]\d+$/i, '');
      if (pinnedInstruments.includes(sym)) {
        unpinInstrument(sym);
      } else {
        pinInstrument(sym);
      }
    },
    [pinnedInstruments, pinInstrument, unpinInstrument],
  );

  const showingSearch = query.trim().length > 0;
  const displayList = showingSearch ? results : bookmarks;

  // Compute dropdown position to align with the correct parent edge
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (fixed) {
        // Align with the parent wrapper (bg-[#111] div) edges
        const wrapper = containerRef.current.parentElement;
        if (wrapper) {
          const wrapperRect = wrapper.getBoundingClientRect();
          setDropdownStyle({
            left: `${wrapperRect.left - rect.left}px`,
            width: `${wrapperRect.width}px`,
          });
        }
      } else {
        // Align with toolbar's left edge
        const toolbar = containerRef.current.closest('.flex');
        const toolbarLeft = toolbar ? toolbar.getBoundingClientRect().left : 0;
        setDropdownStyle({ left: `${toolbarLeft - rect.left}px`, width: '256px' });
      }
    }
  }, [open, fixed]);

  return (
    <div ref={containerRef} className="relative hover:bg-[#1e222d]/50 rounded transition-colors" style={fixed ? undefined : { marginLeft: '8px' }}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={contract ? contract.name : 'Search instrument...'}
        className="bg-transparent border-none px-1 py-1.5 text-xs text-white w-full
                   focus:outline-none placeholder-[#787b86] text-center cursor-pointer"
      />

      {open && (
        <div
          className="absolute top-full mt-1 bg-black border border-[#2a2e39] rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto py-1 animate-dropdown-in"
          style={{
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            ...dropdownStyle,
          }}
        >
          {/* Section label */}
          {!showingSearch && bookmarks.length > 0 && (
            <div className="px-3 pt-2.5 pb-2 text-[10px] text-[#787b86] uppercase tracking-wider text-center">Favorites</div>
          )}

          {searching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#787b86] text-center">Searching...</div>
          )}
          {showingSearch && !searching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#787b86] text-center">No results</div>
          )}
          {!showingSearch && bookmarks.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#787b86] text-center">Type to search instruments</div>
          )}

          {displayList.map((c) => {
            const active = contract?.id === c.id;
            const bookmarked = isBookmarked(c);
            return (
              <div
                key={c.id}
                className={`flex items-center hover:bg-[#1e222d] transition-colors rounded-md mx-1.5 cursor-pointer ${
                  active ? 'bg-[#1e222d]' : ''
                }`}
                style={{ padding: '7px 10px' }}
                onClick={() => handleSelect(c)}
              >
                <div className="flex-1 text-center">
                  <div className={`text-xs font-medium ${active ? 'text-[#f0a830]' : 'text-[#d1d4dc]'}`}>{c.name}</div>
                  <div className="text-[10px] text-[#787b86] truncate">{c.description}</div>
                </div>
                <button
                  onClick={(e) => toggleBookmark(c, e)}
                  className="ml-2 p-0.5 hover:opacity-80 transition-opacity"
                >
                  <StarIcon filled={bookmarked} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
