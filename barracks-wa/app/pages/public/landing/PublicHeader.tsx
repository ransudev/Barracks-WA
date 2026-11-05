"use client";

import { useState } from "react";
import { Logo } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import type { ViewId } from "@/app/types/domain";

export function PublicHeader({ go }: { go: (view: ViewId) => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeMobileMenu = () => setMobileMenuOpen(false);
  const closeAboutMenu = () => setAboutOpen(false);

  return (
    <header className="public-header">
      <nav className="public-nav" aria-label="Primary navigation">
        <Logo onClick={() => go("landing")} />

        <div className="public-nav__links">
          <a className="public-nav__link is-active" href="#home">
            Home
          </a>
          <div className="public-nav__dropdown">
            <button
              className="public-nav__dropdown-trigger"
              type="button"
              aria-expanded={aboutOpen}
              aria-haspopup="true"
              onClick={() => setAboutOpen((open) => !open)}
            >
              <span>About</span>
              <Icon name="chevronDown" size={13} />
            </button>
            {aboutOpen ? (
              <div className="public-nav__dropdown-menu">
                <a href="#about" onClick={closeAboutMenu}>
                  About Barracks
                </a>
                <a href="#studio" onClick={closeAboutMenu}>
                  The Atmosphere
                </a>
                <a href="#branches" onClick={closeAboutMenu}>
                  4 Davao HQs
                </a>
              </div>
            ) : null}
          </div>

          <a className="public-nav__link" href="#services">
            Services
          </a>
          <a className="public-nav__link" href="#branches">
            Branches
          </a>
          <a className="public-nav__link" href="#contact">
            Contact
          </a>
        </div>

        <div className="public-nav__actions">
          <button className="public-nav__login" type="button" onClick={() => go("login")}>
            Login
          </button>

          <button
            type="button"
            className="btn-primary public-nav__book-btn"
            onClick={() => go("customer-booking")}
          >
            <Icon name="calendar" size={14} />
            <span>Book Appointment</span>
          </button>

          <button
            className="public-nav__menu-toggle"
            type="button"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-controls="public-mobile-menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </nav>

      {mobileMenuOpen ? (
        <div className="public-mobile-menu is-open" id="public-mobile-menu">
          <div className="public-mobile-menu__links">
            <a href="#home" onClick={closeMobileMenu}>
              Home
            </a>
            <a href="#about" onClick={closeMobileMenu}>
              About Barracks
            </a>
            <a href="#services" onClick={closeMobileMenu}>
              Services &amp; Pricing
            </a>
            <a href="#branches" onClick={closeMobileMenu}>
              Davao HQs
            </a>
            <a href="#studio" onClick={closeMobileMenu}>
              The Atmosphere
            </a>
            <a href="#contact" onClick={closeMobileMenu}>
              Contact &amp; Hours
            </a>
          </div>
          <div className="public-mobile-menu__actions">
            <button
              type="button"
              className="btn-outlined"
              onClick={() => {
                closeMobileMenu();
                go("login");
              }}
            >
              Login
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                closeMobileMenu();
                go("customer-booking");
              }}
            >
              <Icon name="calendar" size={16} />
              <span>Book Appointment</span>
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
