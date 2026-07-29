import "../../styles/public-content-shared.css";
import "../../styles/member-workflow.css";
import "../../styles/member-forms.css";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OAuthConsentPanel } from "@/components/member-workflow/OAuthConsentPanel";
import { ProtectedAccessUnavailable } from "@/components/member-workflow/ProtectedAccessUnavailable";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { PageHero } from "@/components/public-pages/common";
import { oauthConsentLoginHref } from "@/lib/oauth/consent-login-url";
import { getVerifiedServerSession } from "@/lib/supabase/server-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mōchirīī Social Access",
  description: "Review access to Mōchirīī Social.",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/oauth/consent",
  },
};

type OAuthConsentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

export default async function OAuthConsentPage({ searchParams }: OAuthConsentPageProps) {
  const authorizationId = one((await searchParams).authorization_id).trim().slice(0, 2_048);
  const session = await getVerifiedServerSession();
  if (!session.ok) {
    if (session.reason === "signed-out") redirect(oauthConsentLoginHref(authorizationId));
    return (
      <>
        <BodyPageMarker page="oauth-consent" />
        <ProtectedAccessUnavailable />
      </>
    );
  }

  return (
    <>
      <BodyPageMarker page="oauth-consent" />
      <PageHero
        page="oauthConsent"
        ariaLabel="Guild social access"
        image="./assets/img/leaders/panel.webp"
        imageAlt="Guild consent banner artwork"
        kicker="Guild Social"
        title="Connect Mōchirīī Social"
        center={false}
        intro={<p className="lede">Review the requested guild social access before continuing.</p>}
      />
      <main className="page-main" id="main">
        <div className="container">
          <Suspense fallback={<section className="glass-card glass-card--primary glass-pad auth-panel" aria-busy="true" />}>
            <OAuthConsentPanel initialSignedIn />
          </Suspense>
        </div>
      </main>
    </>
  );
}
