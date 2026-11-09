/**
 * Single source of truth for every user-visible brand string on the desktop side.
 *
 * Copy never hardcodes the product name: i18n resources use `{{product}}` and the
 * i18next instance fills it from `PRODUCT_NAME` at translation time. Renaming the
 * product is therefore a one-line change here (plus the matching server and site
 * constants), not a repository-wide sweep.
 */

export const PRODUCT_NAME = "Locus";

/** Short two-letter mark used in compact chrome such as the sidebar badge. */
export const PRODUCT_MARK = "LQ";

/** Public releases page. The repository slug is an external identity that does not follow the brand. */
export const RELEASES_URL = "https://github.com/jiabai/FrameQ/releases/latest";
