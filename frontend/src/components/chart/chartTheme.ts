import { ColorType, CrosshairMode } from 'lightweight-charts';
import { COLOR_TEXT, COLOR_TEXT_DIM, COLOR_TEXT_MEDIUM, COLOR_BORDER, COLOR_LABEL_TEXT } from '../../constants/colors';
import { FONT_FAMILY } from '../../constants/layout';
import type { DeepPartial, ChartOptions, CandlestickSeriesPartialOptions } from 'lightweight-charts';

const NY_TZ = 'America/New_York';

function utcToNY(utcSeconds: number): Date {
  // Create a date from UTC seconds, then format parts in NY timezone
  return new Date(utcSeconds * 1000);
}

function nyParts(utcSeconds: number) {
  const nyDate = utcToNY(utcSeconds);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(nyDate).map((part) => [part.type, part.value]),
  );
  return parts;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Pure formatter — accepts already-resolved real UTC seconds. */
export function nyTimeFormatterRaw(utcSeconds: number): string {
  const dateParts = nyParts(utcSeconds);
  const mon = MONTH_ABBR[parseInt(dateParts.month, 10) - 1];
  const yr = dateParts.year.slice(-2);
  return `${parseInt(dateParts.day, 10)} ${mon} '${yr}  ${dateParts.hour}:${dateParts.minute}`;
}

/** Pure formatter — accepts already-resolved real UTC seconds. */
export function nyTickMarkFormatterRaw(utcSeconds: number, tickMarkType: number): string {
  const dateParts = nyParts(utcSeconds);
  // tickMarkType: 0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds
  switch (tickMarkType) {
    case 0: return dateParts.year;
    case 1: return `${dateParts.month}/${dateParts.year}`;
    case 2: return `${dateParts.month}/${dateParts.day}`;
    case 3: return `${dateParts.hour}:${dateParts.minute}`;
    case 4: return `${dateParts.hour}:${dateParts.minute}:${dateParts.second}`;
    default: return `${dateParts.hour}:${dateParts.minute}`;
  }
}

export const PRICE_SCALE_FONT_SIZE = 12;
/** Pixel height of a standard LWC price-axis label (font + 4px top/bottom padding). */
export const PRICE_AXIS_LABEL_H = PRICE_SCALE_FONT_SIZE + 8;

export const CHART_OPTIONS: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: COLOR_LABEL_TEXT },
    textColor: COLOR_TEXT,
    fontSize: PRICE_SCALE_FONT_SIZE,
    fontFamily: FONT_FAMILY,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { visible: false },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: COLOR_TEXT_DIM, labelBackgroundColor: COLOR_BORDER },
    horzLine: { color: COLOR_TEXT_DIM, labelBackgroundColor: COLOR_BORDER, labelVisible: false },
  },
  rightPriceScale: {
    borderColor: COLOR_BORDER,
  },
  timeScale: {
    borderColor: COLOR_BORDER,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 15,
    shiftVisibleRangeOnNewBar: true,
    lockVisibleTimeRangeOnResize: true,
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
