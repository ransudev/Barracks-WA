"use client";

/* Inventory photos are user-supplied data URLs, which next/image cannot resize
   or cache, so plain img tags are the right fit for this screen. */
/* eslint-disable @next/next/no-img-element */

import type { ApiInventoryItem } from "@/app/lib/api";
import { Badge, Button } from "@/app/components/ui";
import { statusTone, stockStatus, stockStatusLabel } from "./model";

export function ProductImagePlaceholder() {
  return (
    <span className="product-image-placeholder" aria-hidden="true">
      <svg viewBox="0 0 200 150" focusable="false">
        <rect
          x="10"
          y="10"
          width="180"
          height="130"
          rx="11"
          fill="#f0f2f5"
          stroke="#9299a1"
          strokeWidth="6"
        />
        <circle cx="146" cy="45" r="17" fill="#9299a1" />
        <path d="M14 136 73 62c2-3 6-3 8 0l48 59 16-19c3-4 7-4 10 0l32 34H14Z" fill="#9299a1" />
        <path
          d="m122 119 13-13"
          fill="none"
          stroke="#f0f2f5"
          strokeLinecap="round"
          strokeWidth="5"
        />
      </svg>
    </span>
  );
}

export function StatusBadge({ item }: { item: ApiInventoryItem }) {
  const status = stockStatus(item);
  return <Badge tone={statusTone(status)}>{stockStatusLabel(status)}</Badge>;
}

export function InventoryCard({
  item,
  onOpen,
  onRestock,
}: {
  item: ApiInventoryItem;
  onOpen: () => void;
  onRestock: () => void;
}) {
  const status = stockStatus(item);

  return (
    <article className={`inventory-card inventory-card--${status}`}>
      <button
        type="button"
        className="inventory-card__main"
        onClick={onOpen}
        aria-label={`Open ${item.name}`}
      >
        <span className="inventory-card__media">
          {item.imageUrl ? (
            <img
              className="inventory-card__photo"
              src={item.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <ProductImagePlaceholder />
          )}
        </span>
        <span className="inventory-card__body">
          <h3>{item.name}</h3>
          <p>{item.sku || "No SKU"}</p>
          <span className="inventory-card__row">
            <StatusBadge item={item} />
            <span className="inventory-card__qty">
              {item.quantity}
              <small>{item.unit}</small>
            </span>
          </span>
        </span>
      </button>
      <div className="inventory-card__footer">
        <span>{item.category}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="stockIn"
          disabled={item.status === "inactive" || !item.supplierId}
          title={
            !item.supplierId
              ? "Assign a supplier to this item first (Edit item or Suppliers page)"
              : undefined
          }
          onClick={onRestock}
        >
          Restock
        </Button>
      </div>
    </article>
  );
}

export function LoadingCards() {
  return (
    <div className="inventory-card-grid" aria-label="Loading inventory" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="inventory-card inventory-card--skeleton" key={index}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
