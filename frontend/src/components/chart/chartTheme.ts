import { ColorType, CrosshairMode } from 'lightweight-charts';
import { COLOR_TEXT, COLOR_TEXT_DIM, COLOR_TEXT_MEDIUM, COLOR_BORDER, COLOR_LABEL_TEXT } from '../../constants/colors';
import type { DeepPartial, ChartOptions, CandlestickSeriesPartialOptions } from 'lightweight-charts';

const NY_TZ = 'America/New_York';

function utcToNY(utcSeconds: number): Date {
  // Create a date from UTC seconds, then format parts in NY timezone
  return new Date(utcSeconds * 1000);
}

function nyParts(utcSeconds: number) {
  const d = utcToNY(utcSeconds);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return parts;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function nyTimeFormatter(utcSeconds: number): string {
  const p = nyParts(utcSeconds);
  const mon = MONTH_ABBR[parseInt(p.month, 10) - 1];
  const yr = p.year.slice(-2);
  return `${parseInt(p.day, 10)} ${mon} '${yr}  ${p.hour}:${p.minute}`;
}

function nyTickMarkFormatter(utcSeconds: number, tickMarkType: number): string {
  const p = nyParts(utcSeconds);
  // tickMarkType: 0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds
  switch (tickMarkType) {
    case 0: return p.year;
    case 1: return `${p.month}/${p.year}`;
    case 2: return `${p.month}/${p.day}`;
    case 3: return `${p.hour}:${p.minute}`;
    case 4: return `${p.hour}:${p.minute}:${p.second}`;
    default: return `${p.hour}:${p.minute}`;
  }
}

export const CHART_OPTIONS: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: COLOR_LABEL_TEXT },
    textColor: COLOR_TEXT,
    fontSize: 12,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { visible: false },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: COLOR_TEXT_DIM, labelBackgroundColor: COLOR_BORDER },
    horzLine: { color: COLOR_TEXT_DIM, labelBackgroundColor: COLOR_BORDER },
  },
  rightPriceScale: {
    borderColor: COLOR_BORDER,
  },
  localization: {
    timeFormatter: nyTimeFormatter,
  },
  timeScale: {
    borderColor: COLOR_BORDER,
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: nyTickMarkFormatter,
    rightOffset: 15,
    shiftVisibleRangeOnNewBar: true,
  },
};

export const CANDLESTICK_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: COLOR_TEXT_MEDIUM,
  downColor: '#0097a6',
  borderVisible: false,
  wickUpColor: COLOR_TEXT_MEDIUM,
  wickDownColor: '#0097a6',
  lastValueVisible: false, // Replaced by CountdownPrimitive (price + bar countdown label)
};
