import tomeData from "@/public/data/tome.json";
import { BodyPageMarker } from "../BodyPageMarker";
import { BadgeRow, cleanRoute, ImagePanel, PageHero, ProseStack, StaticImage, text } from "../common";
import { ListBlock, MiniCard, record, records, strings } from "../page-helpers";

export function TomePage() {
  const data = record(tomeData);
  const hero = record(data.hero);
  const intro = record(data.intro);
  const tenets = record(data.tenets);
  const etiquette = record(data.etiquette);
  const rhythm = record(data.rhythm);
  const recognition = record(data.recognition);

  return (
    <>
      <BodyPageMarker page="tome" />
      <PageHero
        page="tome"
        ariaLabel="Tome hero"
        image={text(hero.image, "./assets/img/tome/hero.webp")}
        imageAlt="The Tome banner artwork"
        kicker={text(hero.kicker, "Tome")}
        title={text(hero.title, "The Tome")}
        intro={<ProseStack id="tomeIntro" lines={hero.introBody} />}
        badges={<BadgeRow id="tomeHeroPills" items={strings(hero.pills, 12)} label="Tome summary pills" />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <section>
            <div className="grid-12 grid-gap">
              <aside className="col-4">
                <ImagePanel
                  id="introImage"
                  src={text(intro.image)}
                  alt="Tome artwork"
                  title={text(intro.badge, "Values & Rhythm")}
                  titleElement="p"
                />
              </aside>
              <section className="col-8">
                <div className="glass-card glass-card--primary glass-pad">
                  <h2 className="section-title" id="introTitle">
                    {text(intro.title, "A living guide")}
                  </h2>
                  <ProseStack id="introBody" lines={intro.body} />
                </div>
              </section>
              <div className="col-divider" aria-hidden="true" />
            </div>
          </section>

          {[
            { data: tenets, id: "tenets", image: "tenetsImage", alt: "Tenets artwork", grid: "tenetsGrid" },
            { data: rhythm, id: "rhythm", image: "rhythmImage", alt: "Guild rhythm artwork", grid: "rhythmGrid" },
          ].map((section) => (
            <section className="u-mt-24" key={section.id}>
              <div className="grid-12 grid-gap">
                <section className="col-12">
                  <div className="glass-card glass-card--primary glass-pad">
                    <h2 className="section-title" id={`${section.id}Title`}>
                      {text(section.data.title)}
                    </h2>
                    <p className="muted" id={`${section.id}Desc`}>
                      {text(section.data.description)}
                    </p>
                    <div className="grid-12 grid-gap u-mt-14">
                      <div className="col-6">
                        <div className="glass-card glass-card--soft glass-pad">
                          <StaticImage
                            id={section.image}
                            src={section.data.image}
                            alt={section.alt}
                            width={960}
                            height={640}
                            className="image-panel__img"
                            sizes="(max-width: 980px) calc(100vw - 68px), 760px"
                          />
                          <h3 className="section-title section-title--sm u-mt-12" id={`${section.id}CapTitle`}>
                            {text(section.data.captionTitle)}
                          </h3>
                          <p className="muted" id={`${section.id}CapDesc`}>
                            {text(section.data.caption)}
                          </p>
                        </div>
                      </div>
                      <div className="col-6">
                        <div className="glass-card glass-card--soft glass-pad">
                          <BadgeRow id={`${section.id}Pills`} items={strings(section.data.pills, 12)} label={`${text(section.data.title)} categories`} />
                          <div id={section.grid} className="grid-12 grid-gap u-mt-12">
                            {records(section.data.items).map((item) => (
                              <MiniCard key={text(item.title, "Title")} title={item.title} description={item.description} />
                            ))}
                          </div>
                          <p className="muted u-mt-12" id={`${section.id}Note`}>
                            {text(section.data.note)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                <div className="col-divider" aria-hidden="true" />
              </div>
            </section>
          ))}

          <section className="u-mt-24">
            <div className="grid-12 grid-gap">
              <aside className="col-4">
                <ImagePanel
                  id="etiquetteImage"
                  src={text(etiquette.image)}
                  alt="Etiquette artwork"
                  title={text(etiquette.badge, "How we treat each other")}
                  titleElement="p"
                />
              </aside>
              <section className="col-8">
                <div className="glass-card glass-card--primary glass-pad">
                  <h2 className="section-title" id="etiquetteTitle">
                    {text(etiquette.title, "Etiquette")}
                  </h2>
                  <p className="muted" id="etiquetteDesc">
                    {text(etiquette.description)}
                  </p>
                  <div id="etiquetteBlocks" className="grid-12 grid-gap u-mt-14">
                    {records(etiquette.blocks).slice(0, 6).map((block) => (
                      <ListBlock key={text(block.title, "Section")} title={block.title} items={block.items} />
                    ))}
                  </div>
                  <p className="muted u-mt-12" id="etiquetteNote">
                    {text(etiquette.note)}
                  </p>
                </div>
              </section>
              <div className="col-divider" aria-hidden="true" />
            </div>
          </section>

          <section className="u-mt-24">
            <div className="glass-card glass-card--primary glass-pad">
              <h2 className="section-title" id="recTitle">
                {text(recognition.title, "Recognition")}
              </h2>
              <p className="muted" id="recDesc">
                {text(recognition.description)}
              </p>
              <div className="grid-12 grid-gap u-mt-14">
                <aside className="col-4">
                  <ImagePanel id="recImage" src={text(recognition.image)} alt="Recognition artwork" />
                </aside>
                <section className="col-8">
                  <div id="recGrid" className="grid-12 grid-gap">
                    {records(recognition.items).map((item) => (
                      <MiniCard key={text(item.title, "Title")} title={item.title} description={item.description} />
                    ))}
                  </div>
                  <div className="u-mt-16">
                    <a id="recLink" href={cleanRoute(recognition.ranksHref, "/join")} className="footer-link">
                      Join Mōchirīī
                    </a>
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
