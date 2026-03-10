import type { Contract } from '../../services/marketDataService';

// ---------------------------------------------------------------------------
// Timeframe type + presets
// ---------------------------------------------------------------------------
export type Timeframe = { unit: 1|2|3|4|5|6; unitNumber: number; label: string };

export const DEFAULT_PINNED: Timeframe[] = [
  { unit: 2, unitNumber: 1,  label: '1m'  },
  { unit: 2, unitNumber: 15, label: '15m' },
];

export const MORE_TIMEFRAMES: Timeframe[] = [
  { unit: 2, unitNumber: 3,  label: '3m'  },
  { unit: 3, unitNumber: 1,  label: '1h'  },
  { unit: 3, unitNumber: 4,  label: '4h'  },
  { unit: 4, unitNumber: 1,  label: 'D'   },
];

export const TIMEFRAMES: Timeframe[] = [...DEFAULT_PINNED, ...MORE_TIMEFRAMES];

// ---------------------------------------------------------------------------
// Instrument slice
// ---------------------------------------------------------------------------
export interface InstrumentSlice {
  contract: Contract | null;
  timeframe: Timeframe;
  pinnedTimeframes: Timeframe[];
  pinnedInstruments: string[];
  setContract: (contract: Contract) => void;
  setTimeframe: (tf: Timeframe) => void;
  pinTimeframe: (tf: Timeframe) => void;
  unpinTimeframe: (tf: Timeframe) => void;
  pinInstrument: (symbol: string) => void;
  unpinInstrument: (symbol: string) => void;
}

type Set = {
  (partial: Partial<InstrumentSlice>): void;
  (fn: (s: InstrumentSlice) => Partial<InstrumentSlice>): void;
};

export const createInstrumentSlice = (set: Set): InstrumentSlice => ({
  contract: null,
  timeframe: DEFAULT_PINNED[0],
  pinnedTimeframes: DEFAULT_PINNED,
  pinnedInstruments: ['NQ', 'MNQ'],
  setContract: (contract) => set({ contract }),
  setTimeframe: (timeframe) => set({ timeframe }),
  pinTimeframe: (tf) =>
    set((s) => {
      if (s.pinnedTimeframes.some((p) => p.label === tf.label)) return s;
      const tfWeight = (t: Timeframe) => t.unit * 100000 + t.unitNumber;
      const next = [...s.pinnedTimeframes, tf].sort((a, b) => tfWeight(a) - tfWeight(b));
      return { pinnedTimeframes: next };
    }),
  unpinTimeframe: (tf) =>
    set((s) => ({
      pinnedTimeframes: s.pinnedTimeframes.filter((p) => p.label !== tf.label),
    })),
  pinInstrument: (symbol) =>
    set((s) => {
      if (s.pinnedInstruments.includes(symbol)) return s;
      return { pinnedInstruments: [...s.pinnedInstruments, symbol] };
    }),
  unpinInstrument: (symbol) =>
    set((s) => ({
      pinnedInstruments: s.pinnedInstruments.filter((p) => p !== symbol),
    })),
});
