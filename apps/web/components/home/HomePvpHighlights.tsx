import type { PvpClip } from "@/lib/pvp-clips";
import { pvpDuration } from "@/lib/pvp-clips";
import { HomePvpPlayback } from "./HomePvpPlayback";

export function HomePvpHighlights({ clips }: { clips: readonly PvpClip[] }) {
  return (
    <section className="home-pvp" aria-labelledby="pvp-highlights-heading">
      <div className="home-pvp-heading"><h3 id="pvp-highlights-heading">PvP Highlights</h3><p>Duels from our guild’s path.</p></div>
      {clips.length ? <HomePvpPlayback className="home-pvp-grid">{clips.map(clip => <figure className="home-pvp-card" key={clip.id}>
        <a className="home-pvp-play" data-pvp-play href={clip.source} aria-label={`Play ${clip.title}, ${pvpDuration(clip.durationSeconds)}`}>
          <img src={clip.poster} alt={clip.description} width={clip.width} height={clip.height} loading="lazy" decoding="async" />
          <span className="home-pvp-play-label">Play clip <span className="home-pvp-play-symbol" aria-hidden="true" /></span>
        </a>
        <video hidden controls playsInline preload="none" width={clip.width} height={clip.height} aria-label={clip.title} tabIndex={0}>
          {clip.captions ? <track kind="captions" data-pvp-caption={clip.captions.source} srcLang={clip.captions.language} label={clip.captions.label} /> : null}
        </video>
        <figcaption><h4>{clip.title}</h4><span>{pvpDuration(clip.durationSeconds)}</span></figcaption>
        <p className="home-pvp-status" role="status" aria-live="polite" data-pvp-status />
        <details><summary>Clip description{clip.transcript ? " and transcript" : ""}</summary><p>{clip.description}</p>{clip.transcript ? <p>{clip.transcript}</p> : null}</details>
      </figure>)}</HomePvpPlayback> : <p className="home-pvp-empty">Duel highlights will appear here.</p>}
    </section>
  );
}
