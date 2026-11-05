"use client";

import { SearchInput, SelectField } from "@/app/components/ui";
import type { StockFilter } from "./model";
import type { useInventoryFilters } from "./useInventoryFilters";

export function InventoryFilterBar({
  filters: {
    search,
    setSearch,
    category,
    setCategory,
    supplierFilter,
    setSupplierFilter,
    status,
    setStatus,
    categoryFilterOptions,
    supplierOptions,
  },
}: {
  filters: ReturnType<typeof useInventoryFilters>;
}) {
  return (
    <div className="inventory-filter-bar">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search item name or SKU"
        className="inventory-search"
      />
      <SelectField
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        aria-label="Filter inventory by category"
      >
        <option value="all">All categories</option>
        {categoryFilterOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </SelectField>
      <SelectField
        value={supplierFilter}
        onChange={(event) => setSupplierFilter(event.target.value)}
        aria-label="Filter inventory by supplier"
      >
        <option value="all">All suppliers</option>
        <option value="none">No supplier</option>
        {supplierOptions.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </SelectField>
      <SelectField
        className="inventory-status-filter"
        value={status}
        onChange={(event) => setStatus(event.target.value as StockFilter)}
        aria-label="Filter inventory by stock status"
      >
        <option value="all">All active items</option>
        <option value="in_stock">In stock</option>
        <option value="low_stock">Low stock</option>
        <option value="out_of_stock">Out of stock</option>
        <option value="inactive">Archived</option>
      </SelectField>
    </div>
  );
}
