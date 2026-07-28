export const GALLERY_CATEGORY_SLUGS = [
  "portraits",
  "gatherings",
  "action",
  "scenery",
  "companions",
] as const;

export const GALLERY_MEMBER_SUBMISSIONS_CATEGORY = "member-submissions" as const;
export const GALLERY_ALL_CATEGORY = "all" as const;
export const GALLERY_QUERY_MAX_LENGTH = 80;

export type GalleryCategorySlug = (typeof GALLERY_CATEGORY_SLUGS)[number];
export type GalleryFilterSlug =
  | typeof GALLERY_ALL_CATEGORY
  | typeof GALLERY_MEMBER_SUBMISSIONS_CATEGORY
  | GalleryCategorySlug;

const categorySet = new Set<string>(GALLERY_CATEGORY_SLUGS);
const filterSet = new Set<string>([
  GALLERY_ALL_CATEGORY,
  GALLERY_MEMBER_SUBMISSIONS_CATEGORY,
  ...GALLERY_CATEGORY_SLUGS,
]);

const labels: Record<GalleryFilterSlug, string> = {
  all: "All",
  portraits: "Portraits",
  gatherings: "Gatherings",
  action: "Action",
  scenery: "Scenery",
  companions: "Companions",
  "member-submissions": "Member Submissions",
};

export function normalizedGallerySlug(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isGalleryCategory(value: unknown): value is GalleryCategorySlug {
  return categorySet.has(normalizedGallerySlug(value));
}

export function isGalleryFilter(value: unknown): value is GalleryFilterSlug {
  return filterSet.has(normalizedGallerySlug(value));
}

export function galleryFilterLabel(value: GalleryFilterSlug) {
  return labels[value];
}

export function normalizeGalleryQuery(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, GALLERY_QUERY_MAX_LENGTH);
}

export function galleryItemCategories(value: unknown): GalleryFilterSlug[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizedGallerySlug).filter(isGalleryFilter))];
}
