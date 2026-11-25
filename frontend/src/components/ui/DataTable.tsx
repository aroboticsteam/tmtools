import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  /** CSS grid track, e.g. "90px" or "2fr". Default "1fr". */
  width?: string;
  render: (row: T) => ReactNode;
}

/** Grid-based table: grey header row, hairline rows, scrolls sideways on phones. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  minWidth = 640,
  empty,
  onRowClick,
  selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  minWidth?: number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
}) {
  const template = columns.map((c) => c.width ?? '1fr').join(' ');
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <div
          className="grid items-center gap-3 border-b border-vmd-border bg-neutral-50 px-4 py-2 text-xs font-medium text-vmd-textSubtle"
          style={{ gridTemplateColumns: template }}
          role="row"
        >
          {columns.map((c) => (
            <span key={c.key} role="columnheader">{c.header}</span>
          ))}
        </div>
        {rows.length === 0 && empty}
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <div
              key={key}
              role="row"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`grid items-center gap-3 border-b border-neutral-100 px-4 py-3 text-sm last:border-b-0 ${
                onRowClick ? 'cursor-pointer hover:bg-neutral-50' : ''
              } ${selectedKey === key ? 'bg-neutral-50' : ''}`}
              style={{ gridTemplateColumns: template }}
            >
              {columns.map((c) => (
                <div key={c.key} role="cell" className="min-w-0">{c.render(row)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
