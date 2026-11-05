"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "@/app/components/ui/icons";
import { landingBranches, landingHours } from "@/app/data/landing";
import type { ViewId } from "@/app/types/domain";

const branchImages: Record<string, { src: string; alt: string }> = {
  bajada: {
    src: "/barracks/hq-editorial-bajada.png",
    alt: "Editorial concept of a premium Barracks-style barber floor for Bajada HQ",
  },
  lanang: {
    src: "/barracks/hq-editorial-lanang.png",
    alt: "Editorial concept of a premium Barracks-style barber café for Lanang HQ",
  },
  bangkal: {
    src: "/barracks/hq-editorial-bangkal.png",
    alt: "Editorial concept of a lively Barracks-style barber floor for Bangkal HQ",
  },
  maa: {
    src: "/barracks/hq-editorial-maa.png",
    alt: "Editorial concept of a refined Barracks-style barber floor for Maa HQ",
  },
};

export function BranchesSection({ go }: { go: (view: ViewId) => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const branch = landingBranches[activeIndex];
  const image = branchImages[branch.id];

  const setSlide = (index: number) => {
    setActiveIndex((index + landingBranches.length) % landingBranches.length);
  };

  return (
    <section className="section-branches" id="branches">
      <div className="section-header-center">
        <h2>
          OUR 4 <span className="accent-crimson">HEADQUARTERS</span>
        </h2>
        <p
          style={{
            color: "var(--color-text-muted)",
            maxWidth: 540,
            margin: "0 auto",
            fontSize: 14,
          }}
        >
          {landingHours.label} · {landingHours.timezone}
        </p>
      </div>

      <div className="branches-carousel" aria-label="Barracks Davao headquarters">
        <div className="branches-carousel__media">
          <Image
            key={image.src}
            src={image.src}
            alt={image.alt}
            fill
            sizes="(max-width: 768px) 100vw, 55vw"
            priority={activeIndex === 0}
          />
          <div className="branches-carousel__media-overlay" aria-hidden="true" />
          <div className="branches-carousel__media-caption">
            <strong>0{activeIndex + 1} / 04</strong>
          </div>
        </div>

        <article className="branches-carousel__details" aria-live="polite">
          <div className="branch-card-luxury__header">
            <span className="branch-card-luxury__tag">
              <Icon name="mapPin" size={12} />
              Davao HQ
            </span>
            {branch.landmark ? (
              <span className="branch-card-luxury__landmark">{branch.landmark}</span>
            ) : null}
          </div>

          <div className="branches-carousel__title-block">
            <h3>{branch.name}</h3>
          </div>

          <div className="branch-card-luxury__address">
            <Icon
              name="mapPin"
              size={15}
              style={{ color: "var(--color-primary-bright)", flexShrink: 0, marginTop: 2 }}
            />
            <span>{branch.address}</span>
          </div>

          <div className="branch-card-luxury__roster">
            <span>Barbers</span>
            <strong>{branch.barbers}</strong>
          </div>

          <div className="branch-card-luxury__actions">
            <a href="#contact" className="service-card-frame__link" style={{ fontSize: 11 }}>
              <span>Contact branch</span>
              <Icon name="arrowRight" size={12} />
            </a>
            <button
              type="button"
              className="btn-action-small"
              onClick={() => go("customer-booking")}
            >
              <span>Book at this HQ</span>
              <Icon name="calendar" size={13} />
            </button>
          </div>

          <div className="branches-carousel__controls">
            <button
              type="button"
              className="branches-carousel__arrow"
              aria-label="Previous headquarters"
              onClick={() => setSlide(activeIndex - 1)}
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <div
              className="branches-carousel__dots"
              role="tablist"
              aria-label="Choose headquarters"
            >
              {landingBranches.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={index === activeIndex}
                  aria-label={`Show ${item.name}`}
                  className={index === activeIndex ? "is-active" : ""}
                  onClick={() => setSlide(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className="branches-carousel__arrow"
              aria-label="Next headquarters"
              onClick={() => setSlide(activeIndex + 1)}
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
