import "../styles/public-content-shared.css";
import "../styles/member-workflow.css";
import "../styles/member-forms.css";
import "../styles/member-gallery-submit.css";
import "../styles/member-leader-dashboard.css";
import type { Metadata } from "next";
import { LeaderDashboard } from "@/components/member-workflow/LeaderDashboard";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";
import { SITE_ORIGIN } from "@/lib/public-urls";
import { SITE_OG_LOCALE } from "@/lib/site-metadata";

export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Mōchirīī Leader Dashboard • Gallery Moderation",
  description: "Review pending member gallery image submissions with Discord Moderator access.",
  robots: {
    index: false,
    follow: true,
  },
  alternates: {
    canonical: "/leader-dashboard",
  },
  openGraph: {
    type: "website",
    siteName: "Mōchirīī",
    title: "Mōchirīī Leader Dashboard • Gallery Moderation",
    description: "Review pending member gallery image submissions with Discord Moderator access.",
    locale: SITE_OG_LOCALE,
    url: `${SITE_ORIGIN}/leader-dashboard`,
    images: ["/assets/img/gallery/hero.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mōchirīī Leader Dashboard • Gallery Moderation",
    description: "Review pending member gallery image submissions with Discord Moderator access.",
    images: ["/assets/img/gallery/hero.webp"],
  },
};

export default function LeaderDashboardPage() {
  return (
    <>
      <BodyPageMarker page="leader-dashboard" />
      <PageHero
        page="leader-dashboard"
        ariaLabel="Leader dashboard hero"
        image="./assets/img/gallery/hero.webp"
        imageAlt="Gallery moderation banner artwork"
        kicker="Leader Dashboard"
        title="Gallery Moderation"
        center={false}
        intro={<p className="lede">Review member image uploads, inspect context, and keep moderation decisions traceable.</p>}
      />
      <main className="page-main" id="main">
        <div className="container">
          <LeaderDashboard />
        </div>
      </main>
    </>
  );
}
