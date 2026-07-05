import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import './resizableColumns.css';

type ColumnLike = Record<string, any>;

type ResizableHeaderCellProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  width?: number;
  minWidth?: number;
  onResizeColumn?: (width: number) => void;
  [key: string]: unknown;
};

function getColumnKey(column: ColumnLike, index: number): string {
  if (column.key) return String(column.key);
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join('.');
  if (column.dataIndex) return String(column.dataIndex);
  return `column-${index}`;
}

function readStoredWidths(storageKey: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeStoredWidths(storageKey: string, widths: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // localStorage may be blocked; resizing should still work for this session.
  }
}

export function ResizableHeaderCell({
  children,
  className,
  style,
  width,
  minWidth = 80,
  onResizeColumn,
  ...restProps
}: ResizableHeaderCellProps) {
  const startResize = (event: MouseEvent<HTMLSpanElement>) => {
    if (!onResizeColumn || !width) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      onResizeColumn(Math.round(nextWidth));
    };
    const onMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <th
      {...restProps}
      className={className}
      style={{
        ...style,
        width,
        minWidth: width,
        position: 'relative',
      }}
    >
      {children}
      {onResizeColumn && width ? (
        <span
          className="aimm-resizable-column-handle"
          data-resizable-column
          onMouseDown={startResize}
        />
      ) : null}
    </th>
  );
}

export function useResizableColumns<T extends ColumnLike>(
  columns: T[],
  options: {
    storageKey: string;
    minWidth?: number;
    defaultWidth?: number;
  },
) {
  const minWidth = options.minWidth ?? 80;
  const defaultWidth = options.defaultWidth ?? 120;
  const [widths, setWidths] = useState<Record<string, number>>(() => readStoredWidths(options.storageKey));

  const updateWidth = useCallback(
    (key: string, width: number) => {
      setWidths((current) => {
        const next = { ...current, [key]: width };
        writeStoredWidths(options.storageKey, next);
        return next;
      });
    },
    [options.storageKey],
  );

  const resizeColumns = useCallback(
    (items: T[]): T[] =>
      items.map((column, index) => {
        if (column.hideInTable) return column;
        const key = getColumnKey(column, index);
        const width = Math.max(minWidth, Number(widths[key] ?? column.width ?? defaultWidth));
        const existingOnHeaderCell = column.onHeaderCell;
        const nextColumn: ColumnLike = {
          ...column,
          width,
          onHeaderCell: (...args: unknown[]) => ({
            ...(typeof existingOnHeaderCell === 'function' ? existingOnHeaderCell(...args) : {}),
            width,
            minWidth,
            onResizeColumn: (nextWidth: number) => updateWidth(key, nextWidth),
          }),
        };
        if (Array.isArray(column.children)) {
          nextColumn.children = resizeColumns(column.children as T[]);
        }
        return nextColumn as T;
      }),
    [defaultWidth, minWidth, updateWidth, widths],
  );

  const resizableColumns = useMemo(() => resizeColumns(columns), [columns, resizeColumns]);

  const tableWidth = useMemo(() => {
    const sumColumnWidth = (items: T[]): number =>
      items.reduce((sum, column, index) => {
        if (column.hideInTable) return sum;
        if (Array.isArray(column.children) && column.children.length > 0) {
          return sum + sumColumnWidth(column.children as T[]);
        }
        const key = getColumnKey(column, index);
        return sum + Math.max(minWidth, Number(widths[key] ?? column.width ?? defaultWidth));
      }, 0);
    return Math.max(sumColumnWidth(columns), 720);
  }, [columns, defaultWidth, minWidth, widths]);

  return {
    columns: resizableColumns,
    components: { header: { cell: ResizableHeaderCell } },
    tableWidth,
  };
}
