import recruitmentData from "@/public/data/recruitment.json";
import { BodyPageMarker } from "../BodyPageMarker";
import { RecruitmentAudioPlayer } from "../RecruitmentAudioPlayer";
import { BadgeRow, formatDateUTC, MetaRow, PageHero, ProseStack, publicPath, text } from "../common";
import { record, records, strings } from "../page-helpers";

export function RecruitmentPage() {
  const data = record(recruitmentData);
  const hero = record(data.hero);
  const meta = record(data.meta);
  const audio = record(data.audio);
  const content = record(data.content);
  const sources = records(audio.sources);
  const audioSources = sources.map((source) => ({
    src: publicPath(source.src),
    type: text(source.type),
  }));

  return (
    <>
      <BodyPageMarker page="recruitment" />
      <PageHero
        page="recruitment"
        ariaLabel="Recruitment hero"
        image={text(hero.image, "./assets/img/recruitment/hero.webp")}
        imageAlt={text(hero.alt, "Recruitment banner artwork")}
        atmosphere={text(hero.atmosphere)}
        kicker={text(meta.kicker, "Recruitment")}
        title={text(meta.heading, "Recruitment & Membership")}
        meta={<MetaRow label="Recruitment metadata" items={[meta.author, meta.updated ? formatDateUTC(meta.updated) : ""]} />}
        intro={
          <p className="lede" id="recruitmentIntro">
            {text(meta.intro)}
          </p>
        }
        badges={<BadgeRow id="recruitmentBadges" items={strings(meta.badges)} label="Recruitment tags" />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <div className="grid-12 grid-gap">
            <section className="col-4" aria-describedby="recruitmentAudioDesc">
              <div className="glass-card glass-card--soft glass-pad center-stack">
                <h2 className="section-title section-title--sm" id="recruitmentAudioTitle">
                  {text(audio.title, "A Note")}
                </h2>
                <p className="muted" id="recruitmentAudioDesc">
                  {text(audio.description)}
                </p>
                <RecruitmentAudioPlayer sources={audioSources} />
                <BadgeRow
                  id="recruitmentAudioBadges"
                  items={sources.map((source) => {
                    const type = text(source.type);
                    const slash = type.indexOf("/");
                    return type ? `Audio: ${slash >= 0 ? type.slice(slash + 1) : type}` : "";
                  })}
                  label="Audio formats"
                />
              </div>
            </section>
            <section className="col-8">
              <div className="glass-card glass-card--primary glass-pad">
                <h2 className="section-title" id="recruitmentBodyTitle">
                  {text(content.title, "Recruitment")}
                </h2>
                <ProseStack id="recruitmentBody" lines={content.paragraphs} />
                <ProseStack id="recruitmentConclusion" lines={content.conclusion} className="prose-stack" />
              </div>
            </section>
            <div className="col-divider" aria-hidden="true" />
          </div>
        </div>
      </main>
    </>
  );
}
