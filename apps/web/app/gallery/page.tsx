import "../styles/public-content-shared.css";
import "../styles/public-gallery.css";
import "../styles/shell-gallery-media.css";
import "../styles/shell-lightbox.css";
import { metadataFor } from "@/components/public-pages/metadata";
import { GalleryPage } from "@/components/public-pages/route-pages/GalleryPage";
import { normalizeGalleryRouteState } from "@/lib/gallery/browser-state";

export const metadata = metadataFor("gallery");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialState = normalizeGalleryRouteState(await searchParams);
  return <GalleryPage initialState={initialState} />;
}
