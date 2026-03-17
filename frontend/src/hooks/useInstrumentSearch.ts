import { useState, useEffect, useRef, useCallback } from 'react';
import { marketDataService, type Contract } from '../services/marketDataService';
import { useStore } from '../store/useStore';

export interface InstrumentSearchResult {
  query: string;
  setQuery: (q: string) => void;
  results: Contract[];
  searching: boolean;
  bookmarks: Contract[];
  showingSearch: boolean;
  displayList: Contract[];
  isBookmarked: (c: Contract) => boolean;
  toggleBookmark: (c: Contract, e: React.MouseEvent) => void;
}

/**
 * Shared data/logic hook for instrument search.
 * Handles debounced contract search, pinned instrument (bookmark) resolution,
 * and bookmark toggling. UI stays in the consumer components.
 */
export function useInstrumentSearch(): InstrumentSearchResult {
  const connected = useStore((s) => s.connected);
  const pinnedInstruments = useStore((s) => s.pinnedInstruments);
  const pinInstrument = useStore((s) => s.pinInstrument);
  const unpinInstrument = useStore((s) => s.unpinInstrument);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contract[]>([]);
  const [searching, setSearching] = useState(false);
  const [bookmarks, setBookmarks] = useState<Contract[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Resolve pinned instrument symbols to Contract objects
  useEffect(() => {
    if (!connected || pinnedInstruments.length === 0) {
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
  }, [connected, pinnedInstruments]);

  // Debounced search
  useEffect(() => {
    if (!connected || !query.trim()) {
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
  }, [connected, query]);

  const isBookmarked = useCallback(
    (c: Contract) => pinnedInstruments.some((sym) => c.name.toUpperCase().startsWith(sym.toUpperCase())),
    [pinnedInstruments],
  );

  const toggleBookmark = useCallback(
    (c: Contract, e: React.MouseEvent) => {
      e.stopPropagation();
      const name = c.name;
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

  return {
    query,
    setQuery,
    results,
    searching,
    bookmarks,
    showingSearch,
    displayList,
    isBookmarked,
    toggleBookmark,
  };
}
