import { ReactNode, useMemo, useState } from "react";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  width?: number | string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  emptyMessage?: string;
  searchableField?: (row: T) => string; // optional; provides quick filter
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  emptyMessage = "No rows.",
  searchableField,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null
  );
  const [filter, setFilter] = useState("");

  const filteredSorted = useMemo(() => {
    let out = rows;
    if (filter && searchableField) {
      const needle = filter.toLowerCase();
      out = out.filter((r) => searchableField(r).toLowerCase().includes(needle));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return sort.dir === "asc" ? -1 : 1;
          if (va > vb) return sort.dir === "asc" ? 1 : -1;
          return 0;
        });
      }
    }
    return out;
  }, [rows, columns, sort, filter, searchableField]);

  const onSort = (key: string) => {
    setSort((cur) =>
      cur?.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  };

  return (
    <div>
      {searchableField && (
        <input
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: "6px 10px",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            marginBottom: 8,
            minWidth: 240,
          }}
        />
      )}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-surface)",
          overflowX: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.03)" }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={c.sortValue ? () => onSort(c.key) : undefined}
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    fontWeight: 600,
                    cursor: c.sortValue ? "pointer" : "default",
                    width: c.width,
                    borderBottom: "1px solid var(--color-border)",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                  {sort?.key === c.key && (sort.dir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredSorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: 16,
                    textAlign: "center",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filteredSorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        padding: "6px 12px",
                        verticalAlign: "top",
                      }}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-muted)",
          marginTop: 6,
        }}
      >
        {filteredSorted.length} row{filteredSorted.length === 1 ? "" : "s"}
        {filter && ` (filtered from ${rows.length})`}
      </div>
    </div>
  );
}
