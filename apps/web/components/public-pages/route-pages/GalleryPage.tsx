import galleryData from "@/public/data/gallery.json";
import type { GalleryRouteState } from "@/lib/gallery/browser-state";
import { BodyPageMarker } from "../BodyPageMarker";
import { GalleryBrowser } from "../GalleryBrowser";
import { BadgeRow, PageHero, text } from "../common";
import { record, records, strings } from "../page-helpers";

function GalleryItems({ initialState }: { initialState: GalleryRouteState }) {
  const data = record(galleryData);
  const categories = records(data.categories).map((category) => ({
    slug: text(category.slug),
    label: text(category.label),
  }));
  const items = records(data.albums).flatMap((album) =>
    records(album.items).map((item) => ({
      id: text(item.id),
      src: text(item.src),
      full: text(item.full),
      thumb: text(item.thumb),
      alt: text(item.alt),
      caption: text(item.caption),
      category: text(item.category),
      categories: strings(item.categories),
      galleryAddedAt: text(item.galleryAddedAt),
    })),
  );

  return <GalleryBrowser categories={categories} initialState={initialState} items={items} />;
}

export function GalleryPage({ initialState }: { initialState: GalleryRouteState }) {
  const data = record(galleryData);
  const meta = record(data.meta);

  return (
    <div className="gallery-page" data-gallery-page>
      <BodyPageMarker page="gallery" />
      <PageHero
        page="gallery"
        ariaLabel="Gallery hero"
        image="./assets/img/gallery/hero.webp"
        imageAlt="Gallery banner artwork"
        kicker="Gallery"
        title={text(meta.title, "Guild Album")}
        intro={
          <p className="lede" id="galleryDesc">
            {text(meta.description, "Portraits, gatherings, action, and scenery from the guild album.")}
          </p>
        }
        badges={<BadgeRow items={["Tip: click any image to view it full size."]} label="Gallery tips" />}
      />
      <main className="page-main" id="main">
        <div className="container">
          <section className="glass-card glass-card--primary glass-pad center-stack">
            <h2 className="section-title">Gallery</h2>
            <p className="muted" id="galleryIntro">
              Send screenshots to the Discord gallery channel when a run, view, or tiny guild moment feels worth saving.
            </p>
            <GalleryItems initialState={initialState} />
            <p id="galleryError" className="sr-only" role="status" aria-live="polite" />
          </section>
        </div>
      </main>
    </div>
  );
}
