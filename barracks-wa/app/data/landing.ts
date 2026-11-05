export const landingHours = {
  label: "Monday—Sunday / 9:00 AM—7:30 PM",
  timezone: "Philippine Standard Time",
};

export const landingContact = {
  phone: "(+63) 956 542 6212",
  phoneHref: "+639565426212",
  localPhone: "0956 542 6212",
  email: "barracksdvo@gmail.com",
  socialHandle: "@BARRACKSBARBERS",
  instagramUrl: "https://www.instagram.com/BARRACKSBARBERS",
  facebookUrl: "https://www.facebook.com/BARRACKSBARBERS",
  hashtag: "#WEAREBARRACKS",
};

export const landingEditorialImages = {
  // Original AI-generated editorial imagery keeps the public marketing surface
  // visually consistent without reusing real-world shop photography.
  hero: "/barracks/hero-editorial-ai.png",
  craftCollage: [
    "/barracks/craft-barber-editorial-ai.png",
    "/barracks/craft-interior-editorial-ai.png",
    "/barracks/craft-tools-editorial-ai.png",
    "/barracks/craft-chair-editorial-ai.png",
  ],
  studio: "/barracks/craft-interior-editorial-ai.png",
};

type LandingMenuPrice = {
  amount: string;
  label?: string;
};

export type LandingMenuItem = {
  id: string;
  name: string;
  duration?: string;
  prices: LandingMenuPrice[];
};

type LandingMenuGroup = {
  id: string;
  name: string;
  items: LandingMenuItem[];
};

type LandingServiceSectionBase = {
  id: string;
  number: string;
  name: string;
  description: string;
  duration: string;
};

export type LandingServiceSection =
  | (LandingServiceSectionBase & {
      kind: "items";
      items: LandingMenuItem[];
      groups?: never;
    })
  | (LandingServiceSectionBase & {
      kind: "groups";
      groups: LandingMenuGroup[];
      items?: never;
    });

export const landingServices: LandingServiceSection[] = [
  {
    id: "cut-and-shave",
    kind: "items",
    number: "01",
    name: "Cut & Shave",
    description: "Core Barracks cuts and shave services, with Junior and Senior Barber pricing.",
    duration: "30—75 mins",
    items: [
      {
        id: "barracks-basic",
        name: "Barracks Basic",
        duration: "45 mins",
        prices: [
          { label: "Junior Barber", amount: "₱300" },
          { label: "Senior Barber", amount: "₱400" },
        ],
      },
      {
        id: "signature-shave",
        name: "Signature Shave",
        duration: "30 mins",
        prices: [
          { label: "Junior Barber", amount: "₱300" },
          { label: "Senior Barber", amount: "₱350" },
        ],
      },
      {
        id: "barracks-premium",
        name: "Barracks Premium",
        duration: "75 mins",
        prices: [
          { label: "Junior Barber", amount: "₱550" },
          { label: "Senior Barber", amount: "₱700" },
        ],
      },
    ],
  },
  {
    id: "hair-dye-services",
    kind: "items",
    number: "02",
    name: "Hair Dye Services",
    description: "Professional colour services for a refreshed, well-finished look.",
    duration: "MENU",
    items: [
      { id: "regular-hair-dye", name: "Regular Hair Dye", prices: [{ amount: "₱500 / ₱750*" }] },
      { id: "majicover", name: "Majicover by L'Oréal", prices: [{ amount: "₱800" }] },
      { id: "inoa", name: "INOA by L'Oréal", prices: [{ amount: "₱1,200" }] },
    ],
  },
  {
    id: "hair-and-scalp-care",
    kind: "groups",
    number: "03",
    name: "Hair & Scalp Care",
    description:
      "Scalp care, hair spa, and molecular repair treatments powered by L'Oréal Professionnel.",
    duration: "MENU",
    groups: [
      {
        id: "jacinto-care",
        name: "The Jacinto Care",
        items: [
          {
            id: "scalp-advanced",
            name: "L'Oréal Scalp Advanced",
            prices: [{ amount: "₱1,250 / ₱1,500" }],
          },
          {
            id: "scalp-advanced-a",
            name: "L'Oréal Scalp Advanced-A",
            prices: [{ amount: "₱700 / ₱1,000" }],
          },
          {
            id: "scalp-advanced-b",
            name: "L'Oréal Scalp Advanced-B",
            prices: [{ amount: "₱800 / ₱1,100" }],
          },
        ],
      },
      {
        id: "bonifacio-blow-out",
        name: "Bonifacio Blow-Out",
        items: [
          { id: "hair-spa", name: "L'Oréal Hair Spa", prices: [{ amount: "₱1,250 / ₱1,500" }] },
          { id: "hair-spa-a", name: "L'Oréal Hair Spa-A", prices: [{ amount: "₱700 / ₱1,000" }] },
          { id: "hair-spa-b", name: "L'Oréal Hair Spa-B", prices: [{ amount: "₱800 / ₱1,100" }] },
        ],
      },
      {
        id: "lunas-luxury",
        name: "Lunas Luxury",
        items: [
          {
            id: "absolut-repair-molecular",
            name: "Absolut Repair Molecular",
            prices: [{ amount: "₱1,700 / ₱2,000" }],
          },
        ],
      },
    ],
  },
  {
    id: "other-services",
    kind: "items",
    number: "04",
    name: "Other Services",
    description:
      "Facial care, upper body massage, and deep conditioning treatments to recharge and look sharp.",
    duration: "MENU",
    items: [
      { id: "facial-care", name: "Facial Care Service", prices: [{ amount: "₱300 / ₱550*" }] },
      { id: "upper-body-massage", name: "Upper Body Massage", prices: [{ amount: "₱400" }] },
      { id: "hair-treatment", name: "Hair Treatment", prices: [{ amount: "₱550 / ₱800*" }] },
    ],
  },
  {
    id: "barracks-products",
    kind: "items",
    number: "05",
    name: "Barracks Products",
    description: "Barracks grooming essentials, gift items, and tools to take the finish home.",
    duration: "PRODUCTS",
    items: [
      { id: "amore-pomade", name: "Amore Pomade", prices: [{ amount: "₱250" }] },
      { id: "bravo-hair-tonic", name: "Bravo Hair Tonic", prices: [{ amount: "₱250" }] },
      { id: "chief-sea-salt", name: "Chief Sea Salt", prices: [{ amount: "₱250" }] },
      { id: "delta-styling-powder", name: "Delta Styling Powder", prices: [{ amount: "₱250" }] },
      { id: "elite-cream-pomade", name: "Elite Cream Pomade", prices: [{ amount: "₱300" }] },
      { id: "frost-massage-gel", name: "Frost Massage Gel", prices: [{ amount: "₱200" }] },
      {
        id: "generals-grooming-kit",
        name: "Generals' Grooming Kit",
        prices: [{ amount: "₱1,150" }],
      },
      { id: "gift-vouchers", name: "Gift Vouchers", prices: [{ amount: "₱300 / ₱500" }] },
      { id: "wooden-comb", name: "Barracks Wooden Comb", prices: [{ amount: "₱200" }] },
      { id: "car-decals", name: "Barracks Car Decals", prices: [{ amount: "₱150" }] },
    ],
  },
  {
    id: "retrobee",
    kind: "items",
    number: "06",
    name: "Retrobee",
    description: "Styling staples for hold, texture, and the Barracks finish.",
    duration: "PRODUCTS",
    items: [
      { id: "strong-pomade", name: "Strong Pomade", prices: [{ amount: "₱320 / ₱370" }] },
      { id: "beach-clay", name: "Beach Clay", prices: [{ amount: "₱320 / ₱370" }] },
      { id: "barber-wax", name: "Barber Wax", prices: [{ amount: "₱320 / ₱370" }] },
      { id: "slick-pomade-red", name: "Slick Pomade Red", prices: [{ amount: "₱320 / ₱370" }] },
      { id: "slick-pomade-blue", name: "Slick Pomade Blue", prices: [{ amount: "₱320 / ₱370" }] },
    ],
  },
  {
    id: "loreal-pro",
    kind: "items",
    number: "07",
    name: "L'Oréal Pro",
    description: "Professional care products for scalp health, repair, and growth support.",
    duration: "PRODUCTS",
    items: [
      { id: "anti-dandruff-serum", name: "Anti-Dandruff Serum", prices: [{ amount: "₱500" }] },
      { id: "scalp-hydrate", name: "Scalp Hydrate", prices: [{ amount: "₱500" }] },
      { id: "arm-mask", name: "Arm Mask", prices: [{ amount: "₱1,650" }] },
      { id: "serioxyl-spray", name: "Serioxyl Spray", prices: [{ amount: "₱2,150" }] },
      { id: "serioxyl-shampoo", name: "Serioxyl Shampoo", prices: [{ amount: "₱650" }] },
      { id: "aminexil-serum", name: "Aminexil Serum", prices: [{ amount: "₱550" }] },
    ],
  },
];

export type LandingProduct = LandingMenuItem & {
  sectionId: string;
  sectionName: string;
};

export const landingProducts: LandingProduct[] = landingServices
  .filter((section) => section.duration === "PRODUCTS")
  .flatMap((section) => {
    const items =
      section.kind === "groups" ? section.groups.flatMap((group) => group.items) : section.items;

    return items.map((item) => ({
      ...item,
      sectionId: section.id,
      sectionName: section.name,
    }));
  });

export const landingBranches = [
  {
    id: "bajada",
    name: "Barracks Bajada HQ",
    address: "Surveyor St., Doña Vicenta Village, 19-B, Bajada, Davao City",
    landmark: undefined,
    barbers: "Rodsky, Ernie, Ronnie, Tope",
  },
  {
    id: "lanang",
    name: "Barracks Lanang HQ",
    address: "Unit 5, RNC Building, J.P. Laurel Avenue, Davao City",
    landmark: "Fronting BYD Motors",
    barbers: "Judy, Elizer, Deo, Jorlan",
  },
  {
    id: "bangkal",
    name: "Barracks Bangkal HQ",
    address: "Door 3 & 4, DBR Building, McArthur Highway corner Pag-asa Avenue, Davao City",
    landmark: "Fronting Sam Surplus",
    barbers: "Jun, Kent, Arth, Marcus",
  },
  {
    id: "maa",
    name: "Barracks Maa HQ",
    address: "Unit 1, LiMaria Building, Maa Road, Davao City",
    landmark: "Fronting UM Maa Gate",
    barbers: "Aries, Rex, Gemrick, El",
  },
];
