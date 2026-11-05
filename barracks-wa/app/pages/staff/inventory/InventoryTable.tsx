"use client";

/* Inventory photos are user-supplied data URLs, which next/image cannot resize
   or cache, so plain img tags are the right fit for this screen. */
/* eslint-disable @next/next/no-img-element */

import { IconButton } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import type { ApiInventoryItem } from "@/app/lib/api";
import { formatCurrency } from "@/app/utils/format";
import { ProductImagePlaceholder, StatusBadge } from "./InventoryCard";
import type { SortDirection, SortKey } from "./model";

export function InventoryTable({
  items,
  sortKey,
  sortDirection,
  onSort,
  onOpen,
  onRestock,
  onHistory,
}: {
  items: ApiInventoryItem[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onOpen: (item: ApiInventoryItem) => void;
  onRestock: (item: ApiInventoryItem) => void;
  onHistory: (item: ApiInventoryItem) => void;
}) {
  return (
    <div className="inventory-table-wrap">
      <table className="inventory-data-table">
        <thead>
          <tr>
            {(
              [
                ["name", "Item"],
                ["sku", "SKU"],
                ["supplier", "Supplier"],
                ["quantity", "Current stock"],
                ["threshold", "Min / max"],
                ["unitCost", "Unit cost"],
                ["status", "Status"],
              ] as Array<[SortKey, string]>
            ).map(([key, label]) => (
              <th key={key} scope="col">
                <button type="button" onClick={() => onSort(key)}>
                  {label}
                  <Icon
                    name={sortKey === key && sortDirection === "desc" ? "arrowDown" : "arrowUp"}
                    size={12}
                    className={sortKey === key ? "is-visible" : ""}
                  />
                </button>
              </th>
            ))}
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              tabIndex={0}
              onClick={() => onOpen(item)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(item);
                }
              }}
              aria-label={`Open ${item.name}`}
            >
              <td>
                <button
                  type="button"
                  className="inventory-table__item"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(item);
                  }}
                >
                  <span className="inventory-table__icon">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" />
                    ) : (
                      <ProductImagePlaceholder />
                    )}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.category} · {item.branch}
                    </small>
                  </span>
                </button>
              </td>
              <td>{item.sku || "—"}</td>
              <td>{item.supplierName || "Unassigned"}</td>
              <td
                className={
                  item.quantity <= item.minimumStock && item.status === "active"
                    ? "inventory-table__stock-alert"
                    : ""
                }
              >
                <strong>{item.quantity}</strong> {item.unit}
              </td>
              <td>
                {item.minimumStock} / {item.maximumStock ?? "—"}
              </td>
              <td>{formatCurrency(item.unitCost)}</td>
              <td>
                <StatusBadge item={item} />
              </td>
              <td>
                <span
                  className="inventory-table__actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <IconButton
                    label={`Restock ${item.name}`}
                    icon="stockIn"
                    disabled={item.status === "inactive" || !item.supplierId}
                    onClick={() => onRestock(item)}
                  />
                  <IconButton
                    label={`Edit ${item.name}`}
                    icon="edit"
                    onClick={() => onOpen(item)}
                  />
                  <IconButton
                    label={`History for ${item.name}`}
                    icon="clock"
                    onClick={() => onHistory(item)}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
