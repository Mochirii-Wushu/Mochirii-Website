import Link from "next/link";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, PageHero } from "../common";

const SUPPORT_EMAIL = "support@mochirii.com";
const REQUEST_SUBJECT = "Mochirii data deletion request";

export function MetaDataDeletionPage() {
  const requestHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(REQUEST_SUBJECT)}`;

  return (
    <>
      <BodyPageMarker page="meta-data-deletion" />
      <PageHero
        page="meta-data-deletion"
        ariaLabel="Meta data deletion instructions hero"
        image="/assets/img/gallery/hero.webp"
        imageAlt="A martial artist viewing illuminated landscape paintings in a lantern-lit corridor"
        kicker="Data requests"
        title="Meta Data Deletion Instructions"
        center={false}
        intro={
          <p className="lede" id="metaDataDeletionIntro">
            Use these instructions to request deletion of eligible data held by Mōchirīī for the website Gallery and
            its optional Facebook Page or Instagram publishing integration.
          </p>
        }
        badges={
          <BadgeRow
            id="metaDataDeletionBadges"
            items={["Verified requests", "No passwords or tokens", "Manual review"]}
            label="Deletion-request safeguards"
          />
        }
      />

      <main className="page-main legal-page" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-8 glass-card glass-card--primary glass-pad" aria-labelledby="deletionRequestTitle">
              <p className="kicker">
                Last updated <time dateTime="2026-07-29">July 29, 2026</time>
              </p>
              <h2 className="section-title" id="deletionRequestTitle">How to make a request</h2>
              <ol className="list-stack legal-steps">
                <li>
                  Email <a href={requestHref}>{SUPPORT_EMAIL}</a> with the subject “{REQUEST_SUBJECT}”. Send from the
                  email associated with your Mōchirīī website account when possible.
                </li>
                <li>
                  Include only enough information to locate the data: your website or Discord handle and the
                  submission title or approximate submission date.
                </li>
                <li>
                  Do not send a password, access token, recovery code, signed media URL, or identity document in the
                  initial request. We will reply if another verification step is required.
                </li>
                <li>
                  After verifying the requester, we will review eligible Mōchirīī-held data and communicate the result
                  or any item that requires additional action.
                </li>
              </ol>
              <div className="hero-cta-row u-mt-18">
                <a className="hero-cta hero-cta--primary" href={requestHref}>Start an email request</a>
                <Link className="hero-cta" href="/privacy">Read the privacy notice</Link>
              </div>
            </section>

            <aside className="col-4 glass-card glass-card--soft glass-pad" aria-labelledby="deletionScopeTitle">
              <h2 className="section-title section-title--sm" id="deletionScopeTitle">What this covers</h2>
              <p>
                This process covers Mōchirīī-held website account, Gallery submission, consent, moderation, and Meta
                integration data. It does not delete your Facebook account, Instagram account, or information held by
                those services outside Mōchirīī&apos;s control.
              </p>
              <p>
                Members will not authenticate this publishing integration through Facebook Login. If destination
                publishing is enabled, Mōchirīī intends to use a business-owned publisher for its own Facebook Page and
                a connected professional Instagram account after the provider asset chain is verified.
              </p>
            </aside>

            <section className="col-12 glass-card glass-card--soft glass-pad" aria-labelledby="deletionStateTitle">
              <h2 className="section-title" id="deletionStateTitle">What happens to a Gallery publishing choice</h2>
              <p>
                Automated Facebook and Instagram publishing from new member Gallery submissions is not currently
                active. Support handles current withdrawal and deletion requests manually. The state-specific behavior
                below applies when the hardened destination workflow is enabled.
              </p>
              <div className="legal-grid legal-grid--three">
                <section aria-labelledby="deletionQueuedTitle">
                  <h3 className="section-title section-title--sm" id="deletionQueuedTitle">Queued, failed, or ineligible</h3>
                  <p>
                    An eligible destination job will be cancelled atomically so it cannot be leased for publication.
                    The original consent and the withdrawal event will remain in the audit record.
                  </p>
                </section>
                <section aria-labelledby="deletionReconcileTitle">
                  <h3 className="section-title section-title--sm" id="deletionReconcileTitle">Publishing or uncertain</h3>
                  <p>
                    The job will be quarantined for moderator inspection. We will not automatically retry a provider
                    request that might already have created a public post.
                  </p>
                </section>
                <section aria-labelledby="deletionPublishedTitle">
                  <h3 className="section-title section-title--sm" id="deletionPublishedTitle">Already published</h3>
                  <p>
                    The request will become a removal request for owner-approved handling. It will not mean the
                    external copy has already been deleted.
                  </p>
                </section>
              </div>
            </section>

            <section className="col-8 glass-card glass-card--primary glass-pad" aria-labelledby="deletionLimitsTitle">
              <h2 className="section-title" id="deletionLimitsTitle">Limits and retained evidence</h2>
              <div className="prose-stack">
                <p>
                  Mōchirīī can act on data it controls. Facebook or Instagram reshares, manual Guild-group shares,
                  downloads, screenshots, search caches, and other third-party copies can persist after the original
                  Mōchirīī post is removed.
                </p>
                <p>
                  We may retain limited consent, withdrawal, moderation, security, and request-resolution evidence
                  when needed to protect members, prevent repeat publication, resolve disputes, meet legal duties, or
                  maintain an accurate audit trail. There is currently no broad fixed automatic deletion schedule;
                  verified requests are handled manually.
                </p>
              </div>
            </section>

            <aside className="col-4 glass-card glass-card--soft glass-pad" aria-labelledby="deletionAccountTitle">
              <h2 className="section-title section-title--sm" id="deletionAccountTitle">Account controls</h2>
              <p>
                Signed-in members can review their current website profile from the Account page. Contact support for
                Gallery withdrawal or deletion because moderator and provider state must be checked before action.
              </p>
              <div className="hero-cta-row u-mt-18">
                <Link className="hero-cta" href="/account">Open Account</Link>
                <a className="hero-cta" href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
