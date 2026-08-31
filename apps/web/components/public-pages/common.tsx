import Image from "next/image";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { formatPublicDate } from "@/lib/public-date";

const htmlRouteMap = new Map<string, string>([
  ["index.html", "/"],
  ["join.html", "/join"],
  ["gallery.html", "/gallery"],
  ["leaders.html", "/leaders"],
  ["ranks.html", "/ranks"],
  ["tome.html", "/tome"],
  ["events.html", "/events"],
  ["announcements.html", "/announcements"],
  ["raffles.html", "/raffle"],
  ["recruitment.html", "/recruitment"],
  ["auth.html", "/auth"],
  ["account.html", "/account"],
  ["social.html", "/social"],
  ["gallery-submit.html", "/gallery-submit"],
  ["spotify.html", "/spotify"],
  ["spotlight.html", "/spotlight"],
  ["twills.html", "/twills"],
  ["leader-dashboard.html", "/leader-dashboard"],
]);

export function asArray<T>(value: T[] | readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

export function text(value: unknown, fallback = "") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

export function publicPath(value: unknown, fallback = "") {
  const raw = text(value, fallback);
  if (!raw) return "";
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(raw)) return raw;
  if (raw.startsWith("./")) return `/${raw.slice(2)}`;
  return `/${raw}`;
}

export function cleanRoute(value: unknown, fallback = "#") {
  const raw = text(value, fallback);
  if (/^(https?:|mailto:|tel:|#)/i.test(raw)) return raw;

  const match = raw.match(/^(?:\.\/|\/)?([^?#]+\.html)([?#].*)?$/i);
  if (!match) return raw.startsWith("./") ? raw.slice(1) : raw;

  const mapped = htmlRouteMap.get(match[1].toLowerCase());
  return mapped ? `${mapped}${match[2] || ""}` : raw;
}

export function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

export function formatDateUTC(value: unknown) {
  const raw = text(value);
  if (!raw) return "";

  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return raw;

  return formatPublicDate(date);
}

export function BadgeRow({
  id,
  items,
  label,
  className = "badge-row",
}: {
  id?: string;
  items: Array<string | { label?: string; href?: string }>;
  label?: string;
  className?: string;
}) {
  const cleaned = items
    .map((item) => {
      if (typeof item === "string") return { label: text(item), href: "" };
      return { label: text(item.label), href: cleanRoute(item.href || "", "") };
    })
    .filter((item) => item.label);

  if (!cleaned.length) return null;

  return (
    <div id={id} className={className} aria-label={label}>
      {cleaned.map((item) => (
        <span key={`${item.label}-${item.href || "text"}`}>
          {item.href ? (
            <a
              href={item.href}
              target={isExternalHref(item.href) ? "_blank" : undefined}
              rel={isExternalHref(item.href) ? "noopener noreferrer" : undefined}
            >
              {item.label}
            </a>
          ) : (
            item.label
          )}
        </span>
      ))}
    </div>
  );
}

export function MetaRow({
  label,
  items,
}: {
  label?: string;
  items: unknown[];
}) {
  const cleaned = items.map((item) => text(item)).filter(Boolean);
  if (!cleaned.length) return null;

  return (
    <div className="meta-row" aria-label={label}>
      {cleaned.map((item, index) => (
        <Fragment key={item}>
          {index > 0 ? (
            <span className="meta-dot" aria-hidden="true">
              •
            </span>
          ) : null}
          <span className="meta-text">{item}</span>
        </Fragment>
      ))}
    </div>
  );
}

export function ProseStack({
  id,
  lines,
  fallback = "—",
  className = "prose-stack",
}: {
  id?: string;
  lines: unknown[] | unknown;
  fallback?: string;
  className?: string;
}) {
  const cleanLines = (Array.isArray(lines) ? lines : [lines]).map((line) => text(line)).filter(Boolean);

  return (
    <div id={id} className={className}>
      {cleanLines.length ? (
        cleanLines.map((line) => <p key={line}>{line}</p>)
      ) : (
        <p className="muted">{fallback}</p>
      )}
    </div>
  );
}

export function PageHero({
  page,
  ariaLabel,
  image,
  imageAlt,
  atmosphere,
  kicker,
  title,
  intro,
  meta,
  badges,
  center = true,
}: {
  page: string;
  ariaLabel: string;
  image: string;
  imageAlt: string;
  atmosphere?: string;
  kicker: string;
  title: ReactNode;
  intro?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  center?: boolean;
}) {
  return (
    <header className="page-hero-shell" aria-label={ariaLabel}>
      <div className="container">
        <section className="page-hero page-hero--tall">
          <StaticImage
            id={`${page}HeroImage`}
            src={publicPath(image)}
            alt={imageAlt}
            className="page-hero__img"
            width="1536"
            height="1024"
            priority
            sizes="(max-width: 1232px) calc(100vw - 32px), 1200px"
          />
          {atmosphere ? (
            <img
              id={`${page}Atmosphere`}
              src={publicPath(atmosphere)}
              alt=""
              className="page-hero__atmos"
              decoding="async"
              aria-hidden="true"
            />
          ) : null}
        </section>
      </div>

      <div className="container hero-overlap">
        <section className={`glass-card glass-card--strong glass-pad hero-intro${center ? " center-stack" : ""}`}>
          <p className="kicker" id={`${page}Kicker`}>
            {kicker}
          </p>
          <h1 className="display-title" id={`${page}Heading`}>
            {title}
          </h1>
          {meta}
          {intro}
          {badges}
          <p id={`${page}Error`} className="sr-only" role="status" aria-live="polite" />
        </section>
      </div>
    </header>
  );
}

export function ImagePanel({
  id,
  src,
  alt,
  title,
  titleElement = "h3",
}: {
  id?: string;
  src: string;
  alt: string;
  title?: string;
  titleElement?: "h3" | "p";
}) {
  const TitleElement = titleElement;

  return (
    <div className="glass-card glass-card--soft glass-pad">
      {title ? (
        <TitleElement
          className={`section-title section-title--sm${titleElement === "p" ? " section-title--label" : ""}`}
        >
          {title}
        </TitleElement>
      ) : null}
      <div className="prose-stack">
        <StaticImage
          id={id}
          src={src}
          alt={alt}
          width={960}
          height={640}
          className="image-panel__img"
          sizes="(max-width: 980px) calc(100vw - 68px), 360px"
        />
      </div>
    </div>
  );
}

export function StaticImage({
  id,
  src,
  alt,
  className,
  width,
  height,
  priority = false,
  loading = "lazy",
  sizes,
  style,
  fetchPriority,
}: {
  id?: string;
  src: unknown;
  alt: string;
  className?: string;
  width: number | `${number}`;
  height: number | `${number}`;
  priority?: boolean;
  loading?: "eager" | "lazy";
  sizes?: string;
  style?: CSSProperties;
  fetchPriority?: "high" | "low" | "auto";
}) {
  const imageSrc = publicPath(src);
  if (!imageSrc) return null;

  const resolvedLoading = priority ? "eager" : loading;
  const resolvedFetchPriority = fetchPriority ?? (priority ? "high" : undefined);

  return (
    <Image
      id={id}
      src={imageSrc}
      alt={alt}
      className={className}
      width={Number(width)}
      height={Number(height)}
      sizes={sizes}
      style={style}
      loading={resolvedLoading}
      fetchPriority={resolvedFetchPriority}
    />
  );
}
