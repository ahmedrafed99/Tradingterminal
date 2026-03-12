// ---------------------------------------------------------------------------
// Chart Settings — bar colours, background
// ---------------------------------------------------------------------------

export interface ChartSettingsState {
  chartSettings: {
    // Bars
    upColor: string;
    downColor: string;
    bodyVisible: boolean;
    borderVisible: boolean;
    borderUpColor: string;
    borderDownColor: string;
    wickUpColor: string;
    wickDownColor: string;
    wickVisible: boolean;

    // Canvas
    bgType: 'solid' | 'gradient';
    bgColor: string;
    gradientTopColor: string;
    gradientBottomColor: string;
  };
  setChartSettings: (patch: Partial<ChartSettingsState['chartSettings']>) => void;
}

export type ChartSettingsSlice = ChartSettingsState;

type Set = {
  (partial: Partial<ChartSettingsSlice>): void;
  (fn: (s: ChartSettingsSlice) => Partial<ChartSettingsSlice>): void;
};

export const CHART_SETTINGS_DEFAULTS: ChartSettingsState['chartSettings'] = {
  upColor: '#9598a1',
  downColor: '#0097a6',
  bodyVisible: true,
  borderVisible: false,
  borderUpColor: '#9598a1',
  borderDownColor: '#0097a6',
  wickUpColor: '#9598a1',
  wickDownColor: '#0097a6',
  wickVisible: true,

  bgType: 'solid',
  bgColor: '#000000',
  gradientTopColor: '#1e222d',
  gradientBottomColor: '#000000',
};

export const createChartSettingsSlice = (set: Set): ChartSettingsSlice => ({
  chartSettings: { ...CHART_SETTINGS_DEFAULTS },
  setChartSettings: (patch) =>
    set((s) => ({ chartSettings: { ...s.chartSettings, ...patch } })),
});
