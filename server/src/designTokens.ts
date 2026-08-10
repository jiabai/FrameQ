/**
 * Shared design tokens and base element styles for FrameQ server-rendered web
 * pages (login / dashboard / admin).
 *
 * These pages are standalone HTML documents served as strings, so each page
 * injects {@link designTokenCss} (the `:root` token block) followed by
 * {@link basePageCss} (shared element defaults) into its own `<style>`, then
 * adds page-specific layout that references `var(--fq-*)`.
 *
 * The token values converge the three previously divergent inline palettes onto
 * the FrameQ brand primary `#0066cc` (the value documented in
 * `design-system/globals.css`), a single neutral/background set, one font stack,
 * one radius, one shadow language and one focus-ring treatment.
 *
 * Note: this module is intentionally server-web only. It is NOT imported by the
 * desktop app or the marketing site (`site/`), which keep their own token
 * systems.
 */

/** Brand-aligned design tokens shared by every server web page. */
export function designTokenCss(): string {
  return `
    :root {
      color-scheme: light;
      /* surfaces */
      --fq-bg: #f6f7f8;
      --fq-surface: #ffffff;
      --fq-surface-soft: #f2f4f7;
      /* text */
      --fq-text: #1d1d1f;
      --fq-text-soft: #5f6874;
      --fq-text-on-primary: #ffffff;
      /* brand / semantic */
      --fq-primary: #0066cc;
      --fq-primary-pressed: #0058b0;
      --fq-primary-soft: #e6f1fb;
      --fq-focus-ring: rgba(0, 102, 204, 0.22);
      --fq-link: #0066cc;
      --fq-success: #1f7a3a;
      --fq-success-soft: #e7f6ec;
      --fq-danger: #b42318;
      --fq-danger-soft: #fdecec;
      --fq-warning: #9a5b05;
      /* lines */
      --fq-border: #e2e5e9;
      --fq-border-strong: #cfd6df;
      --fq-divider: #f0f2f5;
      /* shape */
      --fq-radius: 8px;
      --fq-radius-sm: 6px;
      --fq-radius-pill: 999px;
      /* elevation (low-shadow per DESIGN.md) */
      --fq-shadow-card: 0 1px 2px rgba(17, 24, 39, 0.04), 0 6px 20px rgba(17, 24, 39, 0.05);
      --fq-shadow-raised: 0 10px 40px rgba(17, 24, 39, 0.08);
      /* type */
      --fq-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      --fq-font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }
  `;
}

/**
 * Shared base element styles. Pages must still apply layout (body placement,
 * cards, headers) on top of these defaults. Element rules here replace the
 * per-page `:root`/`*`/`body`/`input`/`button` duplicates that previously
 * diverged across login, dashboard and admin.
 */
export function basePageCss(): string {
  return `
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--fq-font);
      background: var(--fq-bg);
      color: var(--fq-text);
      font-size: 16px;
      line-height: 1.5;
    }
    h1, h2, h3, p { margin: 0; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { border: 0; cursor: pointer; background: none; }
    button:disabled { cursor: not-allowed; opacity: 0.58; }
    input, select, textarea {
      background: var(--fq-surface);
      border: 1px solid var(--fq-border-strong);
      border-radius: var(--fq-radius);
      color: var(--fq-text);
      min-height: 42px;
      padding: 0 12px;
      width: 100%;
      outline: none;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--fq-primary);
      box-shadow: 0 0 0 3px var(--fq-focus-ring);
    }
    code {
      font-family: var(--fq-font-mono);
    }
  `;
}
