import "../styles/public-content-shared.css";
import "../styles/public-gallery.css";
import "../styles/shell-gallery-media.css";
import "../styles/shell-lightbox.css";
import { metadataFor } from "@/components/public-pages/metadata";
import { GalleryPage } from "@/components/public-pages/route-pages/GalleryPage";

export const metadata = metadataFor("gallery");

export default GalleryPage;
