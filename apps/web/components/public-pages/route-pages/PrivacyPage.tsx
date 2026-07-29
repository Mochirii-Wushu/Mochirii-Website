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
        ariaLabel="Privacy notice hero"
        image="/assets/img/gallery/hero.webp"
        imageAlt="A martial artist viewing illuminated landscape paintings in a lantern-lit corridor"
        kicker="Privacy"
        title="Mōchirīī Privacy Notice"
        center={false}
        intro={
          <p className="lede" id="privacyIntro">
            This notice explains how the Mōchirīī guild website handles member accounts, Gallery submissions,
            moderation records, and optional publishing to the guild&apos;s Facebook Page or Instagram account.
          </p>
        }
        badges={
          <BadgeRow
            id="privacyBadges"
            items={["Publishing currently disabled", "Destination-specific consent", "Public-copy notice"]}
            label="Privacy notice topics"
          />
        }
      />

      <main className="page-main legal-page" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-8 glass-card glass-card--primary glass-pad" aria-labelledby="privacyScopeTitle">
              <p className="kicker">
                Last updated <time dateTime="2026-07-29">July 29, 2026</time>
              </p>
              <h2 className="section-title" id="privacyScopeTitle">Scope and contact</h2>
              <div className="prose-stack">
                <p>
                  This notice applies to mochirii.com and the member Gallery workflow operated for Mōchirīī. It does
                  not replace the privacy notices of Discord, Facebook, Instagram, Supabase, or Vercel.
                </p>
                <p>
                  Privacy, consent-withdrawal, and deletion questions may be sent to{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                </p>
              </div>
            </section>

            <aside className="col-4 glass-card glass-card--soft glass-pad" aria-labelledby="privacyChoicesTitle">
              <h2 className="section-title section-title--sm" id="privacyChoicesTitle">Publishing availability</h2>
              <p>
                Automated Facebook and Instagram publishing from new member Gallery submissions is not currently
                active. Until the hardened workflow and each destination are separately activated, support handles
                withdrawal and removal requests manually and no new automated social post is made.
              </p>
              <ul className="list-stack">
                <li>When enabled, Facebook Page and Instagram choices will be separate and off by default.</li>
                <li>Members will be able to submit to the Gallery without selecting either public destination.</li>
                <li>Gallery approval and public publication will require separate moderator actions.</li>
                <li>Facebook Page posts may be shared manually into the Mōchirīī Guild group.</li>
              </ul>
            </aside>

            <section className="col-12 glass-card glass-card--soft glass-pad" aria-labelledby="privacyCollectTitle">
              <h2 className="section-title" id="privacyCollectTitle">Information we handle</h2>
              <div className="legal-grid">
                <section aria-labelledby="privacyAccountTitle">
                  <h3 className="section-title section-title--sm" id="privacyAccountTitle">Account and membership</h3>
                  <p>
                    Website account identifiers, editable profile information, session cookies or browser storage used
                    to keep you signed in, Discord identity and role information, onboarding or verification state,
                    and the results of live moderator-role checks.
                  </p>
                </section>
                <section aria-labelledby="privacyUploadTitle">
                  <h3 className="section-title section-title--sm" id="privacyUploadTitle">Gallery submissions</h3>
                  <p>
                    The uploaded image, title, caption, category, file metadata, storage version, and the rights
                    attestation you make for the image and any identifiable people shown in it.
                  </p>
                </section>
                <section aria-labelledby="privacyConsentTitle">
                  <h3 className="section-title section-title--sm" id="privacyConsentTitle">Consent and moderation</h3>
                  <p>
                    When destination publishing is enabled, your selected destination, the server-recorded consent
                    version and time, moderation decisions, moderator caption or Instagram alt-text edits, withdrawal
                    events, and integrity evidence that binds approval to the reviewed image.
                  </p>
                </section>
                <section aria-labelledby="privacyProviderTitle">
                  <h3 className="section-title section-title--sm" id="privacyProviderTitle">Publication and operations</h3>
                  <p>
                    When destination publishing is enabled, destination job state, bounded error categories, provider
                    post or media identifiers and canonical permalinks. We also handle security logs and Vercel
                    analytics and performance measurements used to operate and protect the website.
                  </p>
                </section>
              </div>
            </section>

            <section className="col-8 glass-card glass-card--primary glass-pad" aria-labelledby="privacyUseTitle">
              <h2 className="section-title" id="privacyUseTitle">How we use and disclose information</h2>
              <ul className="list-stack">
                <li>Authenticate members, confirm current guild and moderator access, and protect restricted tools.</li>
                <li>Receive, store, review, display, withdraw, and investigate Gallery submissions.</li>
                <li>
                  If you choose a public destination and a moderator separately approves publication, prepare a
                  metadata-stripped JPEG and send the approved image and copy to that destination.
                </li>
                <li>Keep consent, withdrawal, moderation, publication, and reconciliation records for accountability.</li>
                <li>Detect abuse, diagnose failures, enforce security boundaries, and maintain service reliability.</li>
              </ul>
              <p className="u-mt-18">
                Authorized moderators may access information needed for review. Supabase provides database, private
                storage, and server-function processing; Vercel delivers and measures the website; Discord supplies
                identity and role information; and Meta processes an approved public post for Facebook or Instagram.
                Each provider may process data in countries where it operates under its own terms.
              </p>
            </section>

            <aside className="col-4 glass-card glass-card--soft glass-pad" aria-labelledby="privacyStorageTitle">
              <h2 className="section-title section-title--sm" id="privacyStorageTitle">Private and public copies</h2>
              <p>
                Originals are not public website files. When publishing derivatives are created, they are also kept
                out of public website files. Review and provider-processing access uses private storage and temporary,
                time-limited URLs.
              </p>
              <p>
                Approved Gallery images and destination posts are public. Reshares, group shares, downloads, caches,
                screenshots, and other third-party copies can persist after Mōchirīī removes its own copy.
              </p>
            </aside>

            <section className="col-8 glass-card glass-card--soft glass-pad" aria-labelledby="privacyRetentionTitle">
              <h2 className="section-title" id="privacyRetentionTitle">Retention, withdrawal, and deletion</h2>
              <div className="prose-stack">
                <p>
                  Mōchirīī does not currently apply one broad, fixed automatic deletion schedule to Gallery and Meta
                  integration records. We keep submissions and the related consent, withdrawal, moderation, security,
                  provider-reference, and audit records as needed to operate the workflow, investigate problems, and
                  respond to requests. Verified requests are reviewed and handled manually under the current process.
                </p>
                <p>
                  While automated destination publishing remains inactive, email support to request withdrawal or
                  removal. A moderator will verify the requester, inspect the submission and any existing external
                  copy, keep automated publishing disabled, and record the outcome manually.
                </p>
                <p>
                  When destination publishing is enabled, withdrawing before publication will cancel an eligible
                  destination job. A request made while publishing or while the result is uncertain will be quarantined
                  for moderator inspection. After publication, a withdrawal will create a removal request; it will not
                  represent that Meta or other public copies were automatically removed. Some records may be retained
                  when needed for security, dispute resolution, legal obligations, or an accurate consent and
                  withdrawal audit trail.
                </p>
              </div>
            </section>

            <aside className="col-4 glass-card glass-card--primary glass-pad" aria-labelledby="privacyRightsTitle">
              <h2 className="section-title section-title--sm" id="privacyRightsTitle">Access and requests</h2>
              <p>
                You may ask to access or correct your website information, withdraw an uncompleted public-publishing
                choice, or request deletion of eligible Mōchirīī-held data. We verify the requester before acting.
              </p>
              <div className="hero-cta-row u-mt-18">
                <Link className="hero-cta" href="/meta-data-deletion">Deletion instructions</Link>
                <a className="hero-cta hero-cta--primary" href={`mailto:${SUPPORT_EMAIL}`}>Email support</a>
              </div>
            </aside>

            <section className="col-12 glass-card glass-card--soft glass-pad" aria-labelledby="privacySecurityTitle">
              <h2 className="section-title" id="privacySecurityTitle">Security and notice changes</h2>
              <p>
                We use access controls, row-level database policies, server-only credentials, private storage,
                time-limited media access, destination-specific confirmation, and audit records to reduce risk. No
                online service can guarantee absolute security. We may update this notice as the website or provider
                requirements change and will revise the date above when we do.
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
