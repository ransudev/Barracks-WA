"use client";

import { useState } from "react";
import Image from "next/image";
import { Icon } from "@/app/components/ui/icons";
import {
  landingServices,
  type LandingMenuItem,
  type LandingServiceSection,
} from "@/app/data/landing";
import type { ViewId } from "@/app/types/domain";

type CatalogMode = "services" | "products";

function isProductSection(section: LandingServiceSection) {
  return section.duration === "PRODUCTS";
}

function getFeaturedItem(section: LandingServiceSection, items: LandingMenuItem[]) {
  const featuredIds: Record<string, string> = {
    "cut-and-shave": "barracks-premium",
    "hair-dye-services": "inoa",
    "hair-and-scalp-care": "scalp-advanced",
    "other-services": "upper-body-massage",
    "barracks-products": "generals-grooming-kit",
    retrobee: "strong-pomade",
    "loreal-pro": "anti-dandruff-serum",
  };

  return items.find((item) => item.id === featuredIds[section.id]) ?? items[0];
}

function getItemMeta(item: LandingMenuItem, mode: CatalogMode) {
  return item.duration ?? (mode === "products" ? "Available in shop" : "By appointment");
}

export function ServicesSection({ go }: { go: (view: ViewId) => void }) {
  const [catalogMode, setCatalogMode] = useState<CatalogMode>("services");
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleSections = landingServices.filter((section) =>
    catalogMode === "products" ? isProductSection(section) : !isProductSection(section),
  );
  const activeService = visibleSections[activeIndex] ?? visibleSections[0];

  if (!activeService) return null;

  const menuGroups =
    activeService.kind === "groups"
      ? activeService.groups
      : [{ id: activeService.id, name: "", items: activeService.items }];
  const menuItems = menuGroups.flatMap((group) => group.items);
  const featuredItem = getFeaturedItem(activeService, menuItems);

  if (!featuredItem) return null;

  const menuGroupsWithoutFeature = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id !== featuredItem.id),
    }))
    .filter((group) => group.items.length > 0);
  const productMode = catalogMode === "products";

  const changeMode = (mode: CatalogMode) => {
    setCatalogMode(mode);
    setActiveIndex(0);
  };

  return (
    <section className="section-services-provide" id="services">
      <div className="services-menu-heading" id="services-grid">
        <h2>
          GROOMING, <span className="accent-crimson">REFINED.</span>
        </h2>
      </div>

      <div className="services-menu-mode" role="tablist" aria-label="Choose services or products">
        <button
          type="button"
          role="tab"
          aria-selected={catalogMode === "services"}
          className={catalogMode === "services" ? "is-active" : ""}
          onClick={() => changeMode("services")}
        >
          Services
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={catalogMode === "products"}
          className={catalogMode === "products" ? "is-active" : ""}
          onClick={() => changeMode("products")}
        >
          Products
        </button>
      </div>

      <div
        className="services-menu-categories"
        role="tablist"
        aria-label={`${catalogMode} categories`}
      >
        {visibleSections.map((service, index) => (
          <button
            key={service.id}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "is-active" : ""}
            onClick={() => setActiveIndex(index)}
          >
            <span>{service.number}</span>
            {service.name}
          </button>
        ))}
      </div>

      <div className="services-menu-layout">
        <aside
          className="services-menu-feature"
          aria-label={`Featured ${catalogMode.slice(0, -1)}: ${featuredItem.name}`}
        >
          <div className="services-menu-feature__visual">
            <Image
              src={
                productMode
                  ? "/barracks/products-editorial.png"
                  : "/barracks/services-editorial.png"
              }
              alt={
                productMode
                  ? "Barracks grooming products arranged on a charcoal stone surface"
                  : "Straight razor service in a dark Barracks barbershop"
              }
              fill
              sizes="(max-width: 1024px) 100vw, 36vw"
              className="services-menu-feature__image"
            />
            <span className="services-menu-feature__number" aria-hidden="true">
              {activeService.number}
            </span>
          </div>
          <h3>{featuredItem.name}</h3>
          <p>{activeService.description}</p>

          <div className="services-menu-feature__details">
            <span>{getItemMeta(featuredItem, catalogMode)}</span>
            <div className="services-menu-feature__prices">
              {featuredItem.prices.map((price, index) => (
                <span key={`${featuredItem.id}-feature-price-${index}`}>
                  {price.label ? <small>{price.label}</small> : null}
                  <strong>{price.amount}</strong>
                </span>
              ))}
            </div>
          </div>

          {productMode ? (
            <span className="services-menu-feature__action services-menu-feature__action--static">
              Available in shop <Icon name="shoppingBag" size={14} />
            </span>
          ) : (
            <button
              type="button"
              className="services-menu-feature__action"
              onClick={() => go("customer-booking")}
            >
              Book this service <Icon name="arrowRight" size={14} />
            </button>
          )}
        </aside>

        <div className="services-menu-list">
          <div className="services-menu-list__header">
            <span>{activeService.name} / Menu</span>
            <span>Price</span>
          </div>

          {menuGroupsWithoutFeature.map((group) => (
            <section className="services-menu-group" key={group.id}>
              {group.name ? <h3>{group.name}</h3> : null}
              <div>
                {group.items.map((item, index) => (
                  <div className="services-menu-row" key={item.id}>
                    <div className="services-menu-row__name">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{getItemMeta(item, catalogMode)}</small>
                      </div>
                    </div>

                    <div className="services-menu-row__prices">
                      {item.prices.map((price, priceIndex) => (
                        <span key={`${item.id}-price-${priceIndex}`}>
                          {price.label ? <small>{price.label}</small> : null}
                          <strong>{price.amount}</strong>
                        </span>
                      ))}
                    </div>

                    {productMode ? (
                      <span className="services-menu-row__action services-menu-row__action--static">
                        In shop
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="services-menu-row__action"
                        onClick={() => go("customer-booking")}
                        aria-label={`Book ${item.name}`}
                      >
                        Book <Icon name="arrowRight" size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="services-menu-footer">
        <span>
          {productMode
            ? "Explore the collection in-store."
            : "Appointments available across Barracks locations."}
        </span>
        {!productMode ? (
          <button type="button" className="btn-primary" onClick={() => go("customer-booking")}>
            <Icon name="calendar" size={16} />
            <span>Book a Service</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
