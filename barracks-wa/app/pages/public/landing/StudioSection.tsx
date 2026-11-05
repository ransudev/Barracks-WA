import Image from "next/image";
import { Icon } from "@/app/components/ui/icons";
import { landingContact, landingEditorialImages, landingHours } from "@/app/data/landing";

export function StudioSection() {
  return (
    <section className="section-studio-gogrin" id="studio">
      <div className="studio-visual-frame" style={{ position: "relative", overflow: "hidden" }}>
        <Image
          src={landingEditorialImages.studio}
          alt="Barracks barbershop studio interior"
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
        />
        <div className="studio-visual-frame__tag">BARRACKS · DAVAO BARBER CAFÉ</div>
      </div>

      <div className="studio-text">
        <h2>
          THE BARBER CAFÉ EXPERIENCE <br />
          <span className="accent-crimson">IN DAVAO CITY.</span>
        </h2>

        <p>
          Homegrown in Davao City since 2017, Barracks brings together the relaxed social vibe of a
          specialty coffee lounge with the sharp precision of TESDA-certified master barbers. Grab a
          fresh iced brew, kick back in our leather chairs, and leave with sharp lines and
          effortless confidence.
        </p>

        <div className="studio-specs-list">
          <div className="studio-spec-item">
            <span>Operating Hours</span>
            <strong>{landingHours.label}</strong>
          </div>
          <div className="studio-spec-item">
            <span>Shop Hotline</span>
            <a href={`tel:${landingContact.phoneHref}`}>
              <Icon
                name="phone"
                size={13}
                style={{
                  display: "inline-block",
                  verticalAlign: "-2px",
                  marginRight: 6,
                  color: "var(--color-secondary-bright)",
                }}
              />
              {landingContact.phone}
            </a>
          </div>
          <div className="studio-spec-item">
            <span>Official Email</span>
            <a href={`mailto:${landingContact.email}`}>{landingContact.email}</a>
          </div>
          <div className="studio-spec-item">
            <span>Social Community</span>
            <a href={landingContact.instagramUrl} target="_blank" rel="noreferrer">
              {landingContact.socialHandle} · {landingContact.hashtag}
            </a>
          </div>
        </div>

        <a href="#branches" className="service-card-frame__link" style={{ fontSize: 12 }}>
          <span>Explore All 4 Davao Branches</span>
          <Icon name="arrowRight" size={13} />
        </a>
      </div>
    </section>
  );
}
