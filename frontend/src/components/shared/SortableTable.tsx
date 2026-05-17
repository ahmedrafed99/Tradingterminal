import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { TABLE_ROW_STRIPE } from '../../constants/styles';
import { Z } from '../../constants/layout';

export type SortDir = 'asc' | 'desc';

export interface SortableColumn<T> {
  key: string;
  label: string;
  /** Omit to make column non-sortable. Returns the value used for comparison. */
  sortValue?: (row: T, originalIndex: number) => number | string;
  /** Cell inner content. Wrapper handles padding/alignment via cellClassName. */
  render: (row: T, displayIndex: number, originalIndex: number) => ReactNode;
  /** Wrapper class override. Defaults to 'px-2 text-center whitespace-nowrap'. */
  cellClassName?: string;
}

export interface SortableTableProps<T> {
  rows:        T[];
  columns:     SortableColumn<T>[];
  /** Tailwind grid-cols template, e.g. 'grid-cols-[1fr_0.6fr_1.4fr]'. */
  gridCols:    string;
  /** Stable row identifier — used for selection matching across re-sorts. */
  getRowKey:   (row: T, originalIndex: number) => string | number;
  selectedKey?: string | number | null;
  onRowClick?: (row: T, originalIndex: number) => void;
  defaultSort?: { key: string; dir: SortDir };
  maxHeight?:  number | string;
}

export function SortableTable<T>({
  rows,
  columns,
  gridCols,
  getRowKey,
  selectedKey,
  onRowClick,
  defaultSort,
  maxHeight,
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? 'asc');

  const toggleSort = useCallback((col: SortableColumn<T>) => {
    if (!col.sortValue) return;
    if (col.key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const sortedRows = useMemo(() => {
    const indexed = rows.map((row, originalIndex) => ({ row, originalIndex }));
    if (!sortKey) return indexed;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return indexed;
    const dir = sortDir === 'asc' ? 1 : -1;
    const getValue = col.sortValue;
    indexed.sort((a, b) => {
      const va = getValue(a.row, a.originalIndex);
      const vb = getValue(b.row, b.originalIndex);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return indexed;
  }, [rows, columns, sortKey, sortDir]);

  return (
    <div
      className="text-xs"
      style={{
        maxHeight,
        overflowY: maxHeight !== undefined ? 'auto' : undefined,
        fontFeatureSettings: '"tnum"',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--color-border) transparent',
      }}
    >
      {/* Sticky header */}
      <div className="sticky top-0 bg-(--color-panel) border-b border-(--color-border)" style={{ zIndex: Z.HEADER }}>
        <div className={`grid ${gridCols} items-center h-8 px-4 text-(--color-text-muted)`}>
          {columns.map((col) => {
            const active = sortKey === col.key;
            const sortable = !!col.sortValue;
            return (
              <div
                key={col.key}
                className={`px-2 text-center select-none transition-colors ${sortable ? 'cursor-pointer hover:text-(--color-text)' : ''} ${active ? 'text-(--color-text)' : ''}`}
                onClick={() => toggleSort(col)}
              >
                {col.label}
                {active && (
                  <span className="ml-0.5 text-[10px]">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      {sortedRows.map(({ row, originalIndex }, displayIndex) => {
        const key = getRowKey(row, originalIndex);
        const selected = selectedKey != null && selectedKey === key;
        const stripe = !selected && displayIndex % 2 === 1 ? TABLE_ROW_STRIPE : '';
        const selectedCls = selected ? 'bg-(--color-warning)/10 border border-(--color-warning)/60' : 'border border-transparent';
        return (
          <div
            key={key}
            className={`${stripe} ${selectedCls} row-hover ${onRowClick ? 'cursor-pointer' : ''}`}
            onClick={onRowClick ? () => onRowClick(row, originalIndex) : undefined}
          >
            <div className={`grid ${gridCols} items-center h-7 px-4`}>
              {columns.map((col) => (
                <div key={col.key} className={col.cellClassName ?? 'px-2 text-center whitespace-nowrap'}>
                  {col.render(row, displayIndex, originalIndex)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
