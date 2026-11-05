"use client";

import Image from "next/image";
import { Icon } from "@/app/components/ui/icons";
import type { ViewId } from "@/app/types/domain";

export function HeroSection({ go }: { go: (view: ViewId) => void }) {
  return (
    <section className="hero-gogrin" id="home">
      <div className="hero-gogrin__bg">
        <Image
          src="/barracks/hero-barracks-landscape.png"
          alt="Filipino barber giving a customer a haircut inside the barbershop"
          fill
          priority
          sizes="100vw"
        />
      </div>
      <div className="hero-gogrin__overlay" />

      <div className="hero-gogrin__content">
        <div className="hero-kicker">
          <span className="hero-kicker__rule" />
          <span className="hero-kicker__label">Est. 2017 · Homegrown in Davao</span>
          <span className="hero-kicker__rule" />
        </div>

        <Image
          className="hero-gogrin__brand"
          src="/barracks/logo-transparent.png"
          alt="Barracks Barbers & Shaves"
          width={994}
          height={444}
          priority
          loading="eager"
          sizes="(max-width: 768px) 78vw, 560px"
        />

        <div className="hero-gogrin__actions">
          <button type="button" className="btn-primary" onClick={() => go("customer-booking")}>
            <Icon name="calendar" size={16} />
            <span>Book Appointment</span>
          </button>
          <a href="#services" className="btn-outlined">
            <span>View Our Services</span>
            <Icon name="arrowRight" size={15} />
          </a>
        </div>
      </div>
    </section>
  );
}
