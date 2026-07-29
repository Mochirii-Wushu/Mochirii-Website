const FACEBOOK_PERMALINK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
]);
export const FACEBOOK_CANONICAL_PAGE_ID = "1222888660907862";
export const FACEBOOK_CANONICAL_PAGE_URL =
  "https://www.facebook.com/profile.php?id=61592841711452";

export function normalizeFacebookPermalink(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (
    !raw || raw.length > 1000 || raw.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(raw)
  ) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      !FACEBOOK_PERMALINK_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    if (/%(?:2f|5c)/i.test(url.pathname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const safeSegment = (segment: string, maxLength = 255) =>
      segment.length <= maxLength && /^[A-Za-z0-9_.:-]+$/.test(segment);
    const setCanonicalOrigin = () => {
      url.protocol = "https:";
      url.hostname = "www.facebook.com";
      url.port = "";
    };

    if (
      segments.length === 3 && segments[1] === "posts" &&
      safeSegment(segments[0], 100) && safeSegment(segments[2])
    ) {
      setCanonicalOrigin();
      url.pathname = `/${segments.join("/")}`;
      url.search = "";
    } else if (
      segments.length >= 3 && segments.length <= 5 &&
      segments[1] === "photos" && segments.every((segment, index) =>
        safeSegment(segment, index === 0 ? 100 : 255)
      )
    ) {
      setCanonicalOrigin();
      url.pathname = `/${segments.join("/")}`;
      url.search = "";
    } else if (
      segments.length === 1 &&
      (segments[0] === "photo" || segments[0] === "photo.php")
    ) {
      const fbid = url.searchParams.getAll("fbid");
      const set = url.searchParams.getAll("set");
      if (
        fbid.length !== 1 || !safeSegment(fbid[0]) || set.length > 1 ||
        (set.length === 1 && !safeSegment(set[0]))
      ) {
        return null;
      }
      setCanonicalOrigin();
      url.pathname = "/photo.php";
      url.search = "";
      url.searchParams.set("fbid", fbid[0]);
      if (set[0]) url.searchParams.set("set", set[0]);
    } else if (
      segments.length === 1 &&
      (segments[0] === "story.php" || segments[0] === "permalink.php")
    ) {
      const storyId = url.searchParams.getAll("story_fbid");
      const pageId = url.searchParams.getAll("id");
      if (
        storyId.length !== 1 || pageId.length !== 1 ||
        !safeSegment(storyId[0]) || !safeSegment(pageId[0], 100)
      ) {
        return null;
      }
      setCanonicalOrigin();
      url.pathname = `/${segments[0]}`;
      url.search = "";
      url.searchParams.set("story_fbid", storyId[0]);
      url.searchParams.set("id", pageId[0]);
    } else {
      return null;
    }

    const normalized = url.toString();
    return normalized.length <= 1000 ? normalized : null;
  } catch {
    return null;
  }
}
