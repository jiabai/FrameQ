/**
 * Single source of truth for user-visible brand strings on the server.
 *
 * i18n copy uses `{{product}}` placeholders that `t()` fills from this constant;
 * page chrome and email copy reference it directly. Renaming the product is a
 * one-line change here, not a sweep across the server sources.
 */

export const PRODUCT_NAME = "Locus";

/** Short two-letter mark used by the monogram tile on login, dashboard and admin pages. */
export const PRODUCT_MARK = "LQ";
