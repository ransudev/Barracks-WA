import type { Metadata } from "next";
import { Geist_Mono, Inter, Sora } from "next/font/google";
import { BarracksApp } from "@/app/components/BarracksApp";
import "./globals.css";
import "./design-system.css";
import "./pages/admin/branches.css";
import "./theme.css";
import "./operational-layouts.css";
import "./pages/public/landing.css";
import "./pages/auth/login.css";
import "./pages/customer/booking.css";
import "./components/bookings/booking-picker.css";
import "./components/ui/skeleton.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dashboardSans = Inter({
  variable: "--font-dashboard-sans",
  subsets: ["latin"],
  display: "swap",
});

const dashboardAccent = Sora({
  variable: "--font-dashboard-accent",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Barracks | Barbers & Shaves",
  description:
    "Premium grooming, homegrown in Davao. Barracks Barbers & Shaves brings a modern twist to traditional barbering.",
  icons: {
    icon: "/barracks/tab-icon.png?v=4",
  },
};

const themeBootScript = `
  try {
    var storedTheme = localStorage.getItem("barracks-theme");
    var theme = storedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistMono.variable} ${dashboardSans.variable} ${dashboardAccent.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <BarracksApp />
        {children}
      </body>
    </html>
  );
}
