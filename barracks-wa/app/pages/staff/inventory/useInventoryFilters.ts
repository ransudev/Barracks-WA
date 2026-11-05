import { useMemo, useState } from "react";
import type { ApiInventoryItem, ApiSupplier } from "@/app/lib/api";
import {
  stockStatus,
  stockStatusLabel,
  type SortDirection,
  type SortKey,
  type StockFilter,
} from "./model";

export function useInventoryFilters(items: ApiInventoryItem[], suppliers: ApiSupplier[]) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [status, setStatus] = useState<StockFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const supplierOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const supplier of suppliers) byId.set(supplier.id, supplier.companyName);
    for (const item of items)
      if (item.supplierId && item.supplierName) byId.set(item.supplierId, item.supplierName);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items, suppliers]);
  const categoryFilterOptions = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const matchesSearch =
          !normalizedSearch ||
          `${item.name} ${item.sku ?? ""}`.toLowerCase().includes(normalizedSearch);
        const matchesCategory = category === "all" || item.category === category;
        const matchesSupplier =
          supplierFilter === "all" || String(item.supplierId ?? "none") === supplierFilter;
        const matchesStatus =
          status === "all" ? item.status === "active" : stockStatus(item) === status;
        return matchesSearch && matchesCategory && matchesSupplier && matchesStatus;
      }),
    [category, normalizedSearch, items, status, supplierFilter],
  );
  const sortedFiltered = useMemo(
    () =>
      [...filtered].sort((first, second) => {
        const valueFor = (item: ApiInventoryItem) =>
          sortKey === "name"
            ? item.name.toLowerCase()
            : sortKey === "sku"
              ? (item.sku ?? "").toLowerCase()
              : sortKey === "supplier"
                ? (item.supplierName ?? "").toLowerCase()
                : sortKey === "quantity"
                  ? item.quantity
                  : sortKey === "threshold"
                    ? item.minimumStock
                    : sortKey === "unitCost"
                      ? item.unitCost
                      : stockStatusLabel(stockStatus(item)).toLowerCase();
        const left = valueFor(first);
        const right = valueFor(second);
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return comparison * (sortDirection === "asc" ? 1 : -1);
      }),
    [filtered, sortDirection, sortKey],
  );

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey)
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(nextKey);
      setSortDirection("asc");
    }
  }

  return {
    search,
    setSearch,
    category,
    setCategory,
    supplierFilter,
    setSupplierFilter,
    status,
    setStatus,
    sortKey,
    sortDirection,
    handleSort,
    supplierOptions,
    categoryFilterOptions,
    sortedFiltered,
  };
}
