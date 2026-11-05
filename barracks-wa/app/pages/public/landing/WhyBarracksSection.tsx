import Image from "next/image";
import { Icon } from "@/app/components/ui/icons";
import { landingEditorialImages } from "@/app/data/landing";

export function WhyBarracksSection() {
  const collageImages = landingEditorialImages.craftCollage;

  return (
    <section className="section-craft" id="about">
      {/* GoGrin 4-Photo Quadrant Collage */}
      <div
        className="collage-quad"
        aria-label="Barracks craftsmanship collage"
        style={{ position: "relative" }}
      >
        <div className="collage-quad__cell" style={{ position: "relative", overflow: "hidden" }}>
          <Image
            src={collageImages[0]}
            alt="Barber precision styling in an original Barracks editorial scene"
            fill
            sizes="(max-width: 1024px) 50vw, 240px"
          />
        </div>
        <div className="collage-quad__cell" style={{ position: "relative", overflow: "hidden" }}>
          <Image
            src={collageImages[1]}
            alt="Original cinematic barbershop interior"
            fill
            sizes="(max-width: 1024px) 50vw, 240px"
          />
        </div>
        <div className="collage-quad__cell" style={{ position: "relative", overflow: "hidden" }}>
          <Image
            src={collageImages[2]}
            alt="Original barber workstation and grooming tools"
            fill
            sizes="(max-width: 1024px) 50vw, 240px"
          />
        </div>
        <div className="collage-quad__cell" style={{ position: "relative", overflow: "hidden" }}>
          <Image
            src={collageImages[3]}
            alt="Original leather barber chair and station detail"
            fill
            sizes="(max-width: 1024px) 50vw, 240px"
          />
        </div>

        {/* Central Crest Emblem */}
        <div className="collage-quad__center-badge" aria-hidden="true">
          <Icon
            name="scissors"
            size={14}
            style={{ color: "var(--color-primary-bright)", marginBottom: 2 }}
          />
          <span>EST.</span>
          <strong>2017</strong>
        </div>
      </div>

      {/* Right Side Editorial Story & Pillars */}
      <div className="craft-story">
        <h2>
          Modern grooming. <br />
          <span className="accent-crimson">Dabawenyo craft &amp; culture.</span>
        </h2>

        <p>
          Giving a modern twist to a traditional barbershop since 2017. More than just a haircut,
          Barracks is a modern man-cave and barber café where great conversation, artisan coffee,
          and expert grooming meet. Every style is shaped by TESDA-certified barbers dedicated to
          clean techniques, modern trends, and consistent quality.
        </p>

        {/* 4 Brand Pillars */}
        <div className="craft-story__pillars">
          <div className="craft-pillar-item">
            <strong>Craftsmanship</strong>
            <span>
              Professional barbering by TESDA NC II certified barbers with continuous training.
            </span>
          </div>
          <div className="craft-pillar-item">
            <strong>Community</strong>
            <span>
              Supporting homegrown Dabawenyo talent, local brands, and the people in our chairs.
            </span>
          </div>
          <div className="craft-pillar-item">
            <strong>Culture</strong>
            <span>
              A vibrant Davao-grown space combining sharp grooming with a relaxed café atmosphere.
            </span>
          </div>
          <div className="craft-pillar-item">
            <strong>Charity</strong>
            <span>Giving back and uplifting our Davao community beyond the barber chair.</span>
          </div>
        </div>

        {/* Master Barber Quote Card */}
        <div className="barber-quote-card">
          <div className="barber-quote-card__avatar" aria-hidden="true">
            <span>RS</span>
          </div>
          <div className="barber-quote-card__info">
            <span className="barber-quote-card__quote">
              &ldquo;We&apos;re here to give every Dabawenyo a fresh, confident look — delivered
              with clean technique and good vibes.&rdquo;
            </span>
            <span className="barber-quote-card__name">Rodsky · Senior Barber at Bajada HQ</span>
          </div>
        </div>

        <a href="#branches" className="btn-action-small btn-action-cyan">
          <span>Explore 4 Davao HQs</span>
          <Icon name="arrowRight" size={13} />
        </a>
      </div>
    </section>
  );
}
