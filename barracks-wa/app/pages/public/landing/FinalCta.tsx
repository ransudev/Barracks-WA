import { Icon } from "@/app/components/ui/icons";
import { landingContact } from "@/app/data/landing";
import type { ViewId } from "@/app/types/domain";

export function FinalCta({ go }: { go: (view: ViewId) => void }) {
  return (
    <section className="section-final-cta-gogrin" id="booking">
      <div className="final-cta-card">
        <div className="final-cta-card__left">
          <h2>
            READY FOR YOUR <br />
            <span className="accent-crimson">NEXT FRESH CUT?</span>
          </h2>
          <p>
            Appointments and walk-ins welcome across all 4 Davao HQs. Reserve your chair in advance,
            select your preferred barber, grab an iced coffee, and enjoy the authentic Barracks
            experience.
          </p>
        </div>

        <div className="final-cta-card__right">
          <button
            type="button"
            className="btn-primary"
            style={{ width: "100%", height: 52 }}
            onClick={() => go("customer-booking")}
          >
            <Icon name="calendar" size={18} />
            <span>Book An Appointment</span>
          </button>

          <div className="final-cta-card__policy">
            <span>Direct phone reservations: </span>
            <a
              href={`tel:${landingContact.phoneHref}`}
              style={{
                color: "var(--color-secondary-bright)",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {landingContact.phone}
            </a>
            <br />
            <span>
              See your confirmation on screen and in your dashboard. A 10-minute grace period is
              provided.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
