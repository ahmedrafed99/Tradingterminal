import { useState, useEffect, useRef } from 'react';
import type { Contract } from '../services/marketDataService';
import { useStore } from '../store/useStore';
import { useInstrumentSearch } from '../hooks/useInstrumentSearch';
import { useClickOutside } from '../hooks/useClickOutside';

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
  const contract = useStore((s) =>
    fixed ? s.orderContract
      : s.selectedChart === 'left' ? s.contract : s.secondContract,
  );
  const setContract = useStore((s) =>
    fixed ? s.setOrderContract
      : s.selectedChart === 'left' ? s.setContract : s.setSecondContract,
  );
  const setLinkedChartContract = useStore((s) =>
    !fixed ? null
      : s.orderLinkedToChart === 'left' ? s.setContract
      : s.orderLinkedToChart === 'right' ? s.setSecondContract
      : null,
  );

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    query, setQuery, searching, results,
    showingSearch, displayList, bookmarks,
    isBookmarked, toggleBookmark,
  } = useInstrumentSearch();

  useClickOutside(containerRef, true, () => setOpen(false));

  function handleSelect(c: Contract) {
    setContract(c);
    if (setLinkedChartContract) setLinkedChartContract(c);
    setQuery('');
    setOpen(false);
  }

  // Compute dropdown position to align with the correct parent edge
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (fixed) {
        const wrapper = containerRef.current.parentElement;
        if (wrapper) {
          const wrapperRect = wrapper.getBoundingClientRect();
          setDropdownStyle({
            left: `${wrapperRect.left - rect.left}px`,
            width: `${wrapperRect.width}px`,
          });
        }
      } else {
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
          className="absolute top-full mt-1 bg-black border border-[#2a2e39] rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto py-2 animate-dropdown-in"
          style={{
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            ...dropdownStyle,
          }}
        >
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
