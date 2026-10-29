import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error?: string | null;
  emptyTitle: string;
  emptyHint?: string;
}

/** Generic table with built-in loading, error and empty states. */
export function DataTable<T>({ columns, rows, rowKey, loading, error, emptyTitle, emptyHint }: Props<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Spinner /> Loading…
      </div>
    );
  }
  if (error) return <div className="py-20 text-center text-sm text-red-600">{error}</div>;
  if (rows.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="font-medium text-slate-700">{emptyTitle}</p>
        {emptyHint && <p className="mt-1 text-sm text-slate-500">{emptyHint}</p>}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className="px-4 py-3 font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.header} className="px-4 py-3">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
