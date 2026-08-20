import Link from "next/link";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, PageHero } from "../common";

const SUPPORT_EMAIL = "support@mochirii.com";
const REQUEST_SUBJECT = "Mōchirīī data deletion request";

export function MetaDataDeletionPage() {
  const requestHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(REQUEST_SUBJECT)}`;

  return (
    <>
      <BodyPageMarker page="meta-data-deletion" />
      <PageHero
        page="meta-data-deletion"
        ariaLabel="Data deletion request information hero"
        image="/assets/img/gallery/hero.webp"
        imageAlt="A martial artist viewing illuminated landscape paintings in a lantern-lit corridor"
        kicker="Data requests"
        title="Data Deletion Requests"
        center={false}
        intro={
          <p className="lede" id="metaDataDeletionIntro">
            Use this page to ask Mōchirīī to review deletion of eligible website data it controls. This is not a
            promise that every record or third-party copy can be deleted.
          </p>
        }
        badges={
          <BadgeRow
            id="metaDataDeletionBadges"
            items={["Requester verification", "No secrets by email", "Scope reviewed individually"]}
            label="Deletion request safeguards"
          />
        }
      />

      <main className="page-main legal-page" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-8 glass-card glass-card--primary glass-pad" aria-labelledby="deletionRequestTitle">
              <p className="kicker">
                Last updated <time dateTime="2026-08-13">August 13, 2026</time>
              </p>
              <h2 className="section-title" id="deletionRequestTitle">How to make a request</h2>
              <ol className="list-stack legal-steps">
                <li>
                  Email <a href={requestHref}>{SUPPORT_EMAIL}</a> with the subject “{REQUEST_SUBJECT}”. Send from the
                  email associated with your Mōchirīī website account when possible.
                </li>
                <li>
                  Include only enough information to locate the data, such as your website or Discord handle and a
                  Gallery title or approximate submission date.
                </li>
                <li>
                  Do not send a password, access token, recovery code, signed media URL, or identity document in the
                  initial request.
                </li>
                <li>
                  Mōchirīī may need additional information to verify the requester and locate the data before acting.
                </li>
              </ol>
              <div className="hero-cta-row u-mt-18">
                <a className="hero-cta hero-cta--primary" href={requestHref}>Start an email request</a>
                <Link className="hero-cta" href="/privacy">Read the privacy page</Link>
              </div>
            </section>

            <aside className="col-4 glass-card glass-card--soft glass-pad" aria-labelledby="deletionScopeTitle">
              <h2 className="section-title section-title--sm" id="deletionScopeTitle">Request scope</h2>
              <p>
                A request may concern website-account, Gallery-submission, consent, moderation, or optional
                Instagram-publication records associated with the requester.
              </p>
              <p>
                This page does not delete Facebook, Instagram, Discord, or other provider accounts and cannot remove
                copies outside Mōchirīī&apos;s control.
              </p>
            </aside>

            <section className="col-12 glass-card glass-card--primary glass-pad" aria-labelledby="deletionLimitsTitle">
              <h2 className="section-title" id="deletionLimitsTitle">Current limits</h2>
              <p>
                No automatic site-wide deletion, complete provider propagation, or response deadline is represented
                here. Account, Storage, approved-feed, external-copy, backup, moderation, security, dispute, and
                legal-hold outcomes require review.
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
