import "../styles/public-content-shared.css";
import "../styles/member-workflow.css";
import "../styles/member-forms.css";
import "../styles/member-gallery-submit.css";
import "../styles/member-leader-dashboard.css";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LeaderDashboard } from "@/components/member-workflow/LeaderDashboard";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";
import { SITE_ORIGIN } from "@/lib/public-urls";
import { SITE_OG_LOCALE } from "@/lib/site-metadata";
import { getVerifiedServerSession, verifyServerModeratorAccess } from "@/lib/supabase/server-access";

export const dynamic = "force-dynamic";

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

export default async function LeaderDashboardPage() {
  const session = await getVerifiedServerSession();
  if (!session.ok) {
    if (session.reason === "signed-out") redirect("/auth?redirect=%2Fleader-dashboard");
    throw new Error("Leader access is unavailable.");
  }

  const access = await verifyServerModeratorAccess(session.accessToken);
  if (!access.ok) {
    if (access.reason === "denied" || access.reason === "invalid-token") notFound();
    throw new Error("Leader access is unavailable.");
  }

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
          <LeaderDashboard initialAuthorized />
        </div>
      </main>
    </>
  );
}
