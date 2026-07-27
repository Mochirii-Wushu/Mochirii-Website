import "../../../styles/public-side-pages.css";
import "../../../styles/public-content-shared.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BodyPageMarker } from "@/components/public-pages/BodyPageMarker";
import { RaffleDateTime } from "@/components/public-pages/RaffleDateTime";
import {
  getRaffleRuleVersion,
  rafflePublicModel,
} from "@/lib/raffle/public-view";

type RuleVersionPageProps = {
  params: Promise<{ version: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return rafflePublicModel.rules.versions.map((version) => ({
    version: version.slug,
  }));
}

export async function generateMetadata({ params }: RuleVersionPageProps): Promise<Metadata> {
  const { version: slug } = await params;
  const version = getRaffleRuleVersion(slug);
  if (!version) return {};

  const description = `Immutable rules for ${version.cycleLabel} in the Mochirii Monthly Raffle.`;
  return {
    title: version.title,
    description,
    alternates: { canonical: version.rulesUrl },
    robots: { index: true, follow: true },
  };
}

export default async function RaffleRuleVersionPage({ params }: RuleVersionPageProps) {
  const { version: slug } = await params;
  const version = getRaffleRuleVersion(slug);
  if (!version) notFound();

  return (
    <>
      <BodyPageMarker page="raffles" />
      <main className="page-main" id="main">
        <div className="container raffle-public-layout">
          <section className="glass-card glass-card--primary glass-pad" aria-labelledby="raffleRuleVersionHeading">
            <p className="kicker">Mochirii Monthly Raffle</p>
            <h1 className="display-title" id="raffleRuleVersionHeading">{version.title}</h1>
            <p className="lede">{version.cycleLabel}</p>
            <div className="badge-row u-mt-18" aria-label="Drawing rule notices">
              <span>{version.state === "active" ? "Current official drawing rules" : "Archived official drawing rules"}</span>
              <span>No purchase necessary</span>
            </div>
            <dl className="raffle-date-list u-mt-18">
              <RaffleDateTime instant={version.publishedAt} label="Rules published" />
            </dl>
          </section>

          {version.sections.map((section) => (
            <section className="glass-card glass-card--primary glass-pad u-mt-24" key={section.heading}>
              <h2 className="section-title">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.items.length ? (
                <ul className="list-stack u-mt-18">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}

          <section className="glass-card glass-card--soft glass-pad u-mt-24 raffle-no-purchase">
            <h2 className="section-title section-title--sm">No purchase necessary</h2>
            <p>A purchase or payment never improves eligibility, entry counts, or odds.</p>
            <div className="hero-cta-row u-mt-18">
              <Link className="hero-cta" href="/raffle/rules">Back to raffle rules</Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
