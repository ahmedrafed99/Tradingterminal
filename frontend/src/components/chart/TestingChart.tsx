import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, UTCTimestamp } from 'lightweight-charts';
import { CHART_OPTIONS, CANDLESTICK_OPTIONS } from './chartTheme';
import { PriceLevelPrimitive } from './primitives/PriceLevelPrimitive';
import type { LabelPosition } from './primitives/PriceLevelPrimitive';
import { COLOR_BUY, COLOR_LABEL_TEXT } from '../../constants/colors';

function genBars(n = 200, seed = 100): CandlestickData<UTCTimestamp>[] {
  const out: CandlestickData<UTCTimestamp>[] = [];
  let p = seed;
  const now = Math.floor(Date.now() / 1000);
  const step = 60;
  for (let i = 0; i < n; i++) {
    const open = p;
    const close = p + (Math.random() - 0.5) * 2;
    const high = Math.max(open, close) + Math.random();
    const low = Math.min(open, close) - Math.random();
    out.push({ time: (now - (n - i) * step) as UTCTimestamp, open, high, low, close });
    p = close;
  }
  return out;
}

export function TestingChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const orderLineRef = useRef<PriceLevelPrimitive | null>(null);

  const [labelPos, setLabelPos] = useState<LabelPosition>('mid');
  const [priceLabel, setPriceLabel] = useState<boolean>(true);
  const [price, setPrice] = useState<number>(0);
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${m}`, ...l].slice(0, 12));

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, CHART_OPTIONS);
    const series = chart.addSeries(CandlestickSeries, CANDLESTICK_OPTIONS);
    const data = genBars(200, 100);
    series.setData(data);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    const startPrice = data[data.length - 1].close;
    setPrice(startPrice);

    const orderLine = new PriceLevelPrimitive({
      price: startPrice,
      cellOrder: ['size', 'orderType', 'direction', 'close'],
      labelPosition: 'mid',
      lineColor: COLOR_BUY,
      lineStyle: 'dashed',
      priceLabel: { visible: true, tickSize: 0.25 },
      cells: {
        size:      { text: '1',     bg: COLOR_BUY,    color: COLOR_LABEL_TEXT, onClick: () => pushLog('size click') },
        orderType: { text: 'LIMIT', bg: '#cac9cb',    color: COLOR_LABEL_TEXT, onClick: () => pushLog('orderType click') },
        direction: { text: 'BUY',   bg: COLOR_BUY,    color: COLOR_LABEL_TEXT, onClick: () => pushLog('direction click') },
        close:     { text: '✕',     bg: '#444',       color: '#fff',           hoverBg: '#a00', onClick: () => pushLog('close (X) click') },
      },
      onDrag: (p) => setPrice(p),
      onDragEnd: (p) => pushLog(`drag end @ ${p.toFixed(4)}`),
    });
    series.attachPrimitive(orderLine);
    orderLine.setChartElement(containerRef.current);
    orderLineRef.current = orderLine;

    const ro = new ResizeObserver(() => {
      const el = containerRef.current!;
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      orderLineRef.current = null;
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Apply label position changes
  useEffect(() => {
    orderLineRef.current?.setLabelPosition(labelPos);
  }, [labelPos]);

  useEffect(() => {
    orderLineRef.current?.setPriceLabelVisible(priceLabel);
  }, [priceLabel]);

  // Cell color randomizer demo
  const randColor = () => `hsl(${Math.floor(Math.random() * 360)} 70% 50%)`;
  const recolor = (key: string) => {
    orderLineRef.current?.setCell(key, { bg: randColor(), color: '#fff' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
        <strong>PriceLevelPrimitive — Test</strong>
        <span style={{ marginLeft: 12, opacity: 0.7 }}>Label position:</span>
        {(['left', 'mid', 'right'] as LabelPosition[]).map((p) => (
          <button
            key={p}
            onClick={() => setLabelPos(p)}
            style={{
              padding: '4px 10px',
              background: labelPos === p ? 'var(--color-accent)' : 'var(--color-surface)',
              color: labelPos === p ? 'var(--color-accent-text)' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {p}
          </button>
        ))}
        <span style={{ marginLeft: 12, opacity: 0.7 }}>Recolor cell:</span>
        {(['size', 'orderType', 'direction', 'close'] as const).map((k) => (
          <button
            key={k}
            onClick={() => recolor(k)}
            style={{ padding: '4px 10px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {k}
          </button>
        ))}
        <label style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={priceLabel} onChange={(e) => setPriceLabel(e.target.checked)} />
          price label
        </label>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace' }}>price: {price.toFixed(4)}</span>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      </div>

      <div style={{ height: 140, overflowY: 'auto', borderTop: '1px solid var(--color-border)', padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
        <div style={{ opacity: 0.7, marginBottom: 4 }}>Event log:</div>
        {log.length === 0 ? <div style={{ opacity: 0.5 }}>(click cells, drag the label to update price)</div> : null}
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
