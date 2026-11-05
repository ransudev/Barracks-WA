import { Logo } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import { landingContact, landingHours } from "@/app/data/landing";

export function PublicFooter() {
  return (
    <footer className="public-footer" id="contact">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand-col">
            <Logo />
            <p>
              Homegrown in Davao since 2017. Giving a modern twist to a traditional barbershop
              through sharp craftsmanship, barber café culture, and community.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <span className="barbershop-crest__badge" style={{ fontSize: 10 }}>
                {landingContact.hashtag}
              </span>
            </div>
          </div>

          <div className="footer-col">
            <h4>Davao Headquarters</h4>
            <span>Bajada HQ · Surveyor St., Doña Vicenta</span>
            <span>Lanang HQ · RNC Bldg, J.P. Laurel Ave</span>
            <span>Bangkal HQ · DBR Bldg, McArthur Hwy</span>
            <span>Maa HQ · LiMaria Bldg, Maa Rd</span>
          </div>

          <div className="footer-col">
            <h4>Contact &amp; Hours</h4>
            <a href={`tel:${landingContact.phoneHref}`}>
              <Icon
                name="phone"
                size={13}
                style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }}
              />
              {landingContact.phone}
            </a>
            <a href={`mailto:${landingContact.email}`}>
              <Icon
                name="mail"
                size={13}
                style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }}
              />
              {landingContact.email}
            </a>
            <a href={landingContact.instagramUrl} target="_blank" rel="noreferrer">
              Instagram: {landingContact.socialHandle}
            </a>
            <a href={landingContact.facebookUrl} target="_blank" rel="noreferrer">
              Facebook: {landingContact.socialHandle}
            </a>
            <span style={{ color: "var(--color-text-dim)", fontSize: 12, marginTop: 4 }}>
              {landingHours.label}
            </span>
          </div>
        </div>

        <div className="footer-bottom">
          <span>
            &copy; {new Date().getFullYear()} Barracks Barbers &amp; Shaves. Homegrown in Davao
            City.
          </span>
          <span>10-Minute Grace Period on Bookings · {landingContact.hashtag}</span>
        </div>
      </div>
    </footer>
  );
}
