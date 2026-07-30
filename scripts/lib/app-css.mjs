import { readText } from "./repo-paths.mjs";

export const appCssFiles = [
  "apps/web/app/mochirii.css",
  "apps/web/app/styles/tokens-base.css",
  "apps/web/app/styles/font-fallbacks.css",
  "apps/web/app/styles/shared-ui.css",
  "apps/web/app/styles/public-join.css",
  "apps/web/app/styles/public-events.css",
  "apps/web/app/styles/public-side-pages.css",
  "apps/web/app/styles/public-content-shared.css",
  "apps/web/app/styles/public-home-seal.css",
  "apps/web/app/styles/public-home-media.css",
  "apps/web/app/styles/public-home-bulletins.css",
  "apps/web/app/styles/public-home-doors.css",
  "apps/web/app/styles/public-home-visual.css",
  "apps/web/app/styles/public-profiles.css",
  "apps/web/app/styles/public-profile-cards.css",
  "apps/web/app/styles/public-ceremony.css",
  "apps/web/app/styles/public-gallery.css",
  "apps/web/app/styles/shell-gallery-media.css",
  "apps/web/app/styles/public-not-found.css",
  "apps/web/app/styles/public-legal.css",
  "apps/web/app/styles/member-workflow.css",
  "apps/web/app/styles/member-account.css",
  "apps/web/app/styles/member-forms.css",
  "apps/web/app/styles/member-gallery-submit.css",
  "apps/web/app/styles/member-leader-dashboard.css",
  "apps/web/app/styles/shell-lightbox.css",
  "apps/web/app/styles/shell-header-nav.css",
  "apps/web/app/styles/shell-mobile-menu.css",
  "apps/web/app/styles/shell-footer.css",
  "apps/web/app/styles/mochi-pets.css",
];

export function readAppCss() {
  return appCssFiles.map((file) => readText(file)).join("\n");
}
