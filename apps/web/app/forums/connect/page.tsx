import "../../styles/public-content-shared.css";
import "../../styles/member-workflow.css";
import "../../styles/member-forms.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ForumsConnectPanel } from "@/components/member-workflow/ForumsConnectPanel";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mōchirīī Forums Access",
  description: "Continue to Mōchirīī Forums with your verified member account.",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/forums/connect",
  },
};

export default function ForumsConnectPage() {
  return (
    <>
      <BodyPageMarker page="forums-connect" />
      <PageHero
        page="forumsConnect"
        ariaLabel="Mōchirīī Forums access"
        image="./assets/img/leaders/panel.webp"
        imageAlt="Guild forums banner artwork"
        kicker="Member Forums"
        title="Enter Mōchirīī Forums"
        center={false}
        intro={<p className="lede">Continue with your existing Mōchirīī member account.</p>}
      />
      <main className="page-main" id="main">
        <div className="container">
          <Suspense fallback={<section className="glass-card glass-card--primary glass-pad auth-panel" aria-busy="true" />}>
            <ForumsConnectPanel />
          </Suspense>
        </div>
      </main>
    </>
  );
}
