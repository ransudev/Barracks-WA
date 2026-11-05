"use client";

import { useEffect } from "react";
import type { ViewId } from "@/app/types/domain";
import { BranchesSection } from "./landing/BranchesSection";
import { FinalCta } from "./landing/FinalCta";
import { HeroSection } from "./landing/HeroSection";
import { PublicFooter } from "./landing/PublicFooter";
import { PublicHeader } from "./landing/PublicHeader";
import { ServicesSection } from "./landing/ServicesSection";
import { StudioSection } from "./landing/StudioSection";
import { WhyBarracksSection } from "./landing/WhyBarracksSection";

export function LandingPage({ go }: { go: (view: ViewId) => void }) {
  useEffect(() => {
    const site = document.querySelector<HTMLElement>(".public-site");

    if (!site) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    site.classList.add("motion-ready");

    const sections = Array.from(site.querySelectorAll<HTMLElement>("main > section:not(#home)"));
    if (!("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-visible"));
      return () => {
        site.classList.remove("motion-ready");
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px 80px 0px", threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
      site.classList.remove("motion-ready");
    };
  }, []);

  return (
    <div className="public-site">
      <PublicHeader go={go} />
      <main>
        <HeroSection go={go} />
        <ServicesSection go={go} />
        <WhyBarracksSection />
        <BranchesSection go={go} />
        <StudioSection />
        <FinalCta go={go} />
      </main>
      <PublicFooter />
    </div>
  );
}
