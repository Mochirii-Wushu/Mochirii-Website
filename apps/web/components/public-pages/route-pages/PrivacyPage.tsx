import Link from "next/link";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, PageHero } from "../common";

const SUPPORT_EMAIL = "support@mochirii.com";

export function PrivacyPage() {
  return (
    <>
      <BodyPageMarker page="privacy" />
      <PageHero
        page="privacy"
        ariaLabel="Privacy information hero"
        image="/assets/img/gallery/hero.webp"
        imageAlt="A martial artist viewing illuminated landscape paintings in a lantern-lit corridor"
        kicker="Privacy"
        title="Privacy"
        center={false}
        intro={
          <p className="lede" id="privacyIntro">
            This page summarizes information handled by the Mōchirīī website and provides a contact for privacy
            questions. It does not describe every Mōchirīī service or replace a third-party provider&apos;s notice.
          </p>
        }
        badges={
          <BadgeRow
            id="privacyBadges"
            items={["Website scope", "Privacy contact", "Provider notices remain separate"]}
            label="Privacy information topics"
          />
        }
      />

      <main className="page-main legal-page" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-8 glass-card glass-card--primary glass-pad" aria-labelledby="privacyScopeTitle">
              <p className="kicker">
                Last updated <time dateTime="2026-08-13">August 13, 2026</time>
              </p>
              <h2 className="section-title" id="privacyScopeTitle">Website scope</h2>
              <div className="prose-stack">
                <p>
                  The website source includes public pages, member sign-in and guild verification, protected account
                  and Gallery workflows, analytics and performance components, and user-activated external links or
                  embeds. Some deployed-runtime and provider details still require separate verification.
                </p>
                <p>
                  Depending on the feature used, the website can handle account and provider identifiers, profile and
                  guild-role information, session and verification state, Gallery images and submission metadata,
                  moderation records, and optional Instagram-sharing choices.
                </p>
              </div>
            </section>

            <aside className="col-4 glass-card glass-card--soft glass-pad" aria-labelledby="privacyContactTitle">
              <h2 className="section-title section-title--sm" id="privacyContactTitle">Questions and requests</h2>
              <p>
                For privacy, correction, withdrawal, or deletion questions about Mōchirīī-held website data, email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
              </p>
              <p>
                Do not include a password, access token, recovery code, signed media URL, or identity document in the
                initial email.
              </p>
              <div className="hero-cta-row u-mt-18">
                <Link className="hero-cta" href="/meta-data-deletion">Deletion request instructions</Link>
              </div>
            </aside>

            <section className="col-12 glass-card glass-card--soft glass-pad" aria-labelledby="privacyChoicesTitle">
              <h2 className="section-title" id="privacyChoicesTitle">Gallery choices and public copies</h2>
              <div className="legal-grid">
                <section aria-labelledby="privacySharingTitle">
                  <h3 className="section-title section-title--sm" id="privacySharingTitle">Optional sharing</h3>
                  <p>
                    Instagram sharing is optional and defaults off in source. Gallery approval and external sharing
                    are separate actions.
                  </p>
                </section>
                <section aria-labelledby="privacyDeliveryTitle">
                  <h3 className="section-title section-title--sm" id="privacyDeliveryTitle">Approved Gallery items</h3>
                  <p>
                    Approved Gallery items can include uploader display information and are delivered through bounded
                    public media URLs.
                  </p>
                </section>
              </div>
            </section>

            <section className="col-12 glass-card glass-card--primary glass-pad" aria-labelledby="privacyLimitsTitle">
              <h2 className="section-title" id="privacyLimitsTitle">Current limits</h2>
              <p>
                If content has been published or shared outside Mōchirīī, copies may remain outside Mōchirīī&apos;s
                control. The current source does not establish one complete retention schedule or a guaranteed
                response deadline.
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
