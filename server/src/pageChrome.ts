/**
 * Shared FrameQ brand chrome for server-rendered web pages.
 *
 * Brand identity (the `FQ` monogram tile, its row layout and the eyebrow label)
 * must read as one product across `/login`, `/dashboard`, `/admin/login` and
 * `/admin`. Each page injects {@link brandChromeCss} into its `<style>` and
 * composes its header with {@link renderBrandMark}, so the brand mark is defined
 * once instead of being copy-pasted per page.
 *
 * The brand mark is decorative (`aria-hidden`): the accessible product/page name
 * comes from the heading in each header.
 */

/** Shared CSS for `.brand-row`, `.brand-mark` and `.eyebrow`. Consumes `var(--fq-*)`. */
export function brandChromeCss(): string {
  return `
    .brand-row { align-items: center; display: flex; gap: 12px; min-width: 0; }
    .brand-mark {
      align-items: center;
      background: var(--fq-primary);
      border-radius: var(--fq-radius);
      color: var(--fq-text-on-primary);
      display: inline-flex;
      flex: 0 0 auto;
      font-size: 0.78rem;
      font-weight: 800;
      height: 38px;
      justify-content: center;
      letter-spacing: 0;
      width: 38px;
    }
    .eyebrow {
      color: var(--fq-text-soft);
      font-size: 0.74rem;
      font-weight: 760;
      letter-spacing: 0;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
  `;
}

/** Renders the FrameQ `FQ` monogram tile. Decorative — not exposed to AT. */
export function renderBrandMark(): string {
  return `<span class="brand-mark" aria-hidden="true">FQ</span>`;
}

/** Options for {@link renderFrameHeader}. */
export type FrameHeaderOptions = {
  /** Optional eyebrow label above the title (e.g. "FrameQ Admin"). */
  eyebrow?: string;
  /** Page title (already localized). */
  title: string;
  /** Optional id for the title heading (for `aria-labelledby` on a section). */
  titleId?: string;
  /** Optional HTML rendered under the title (e.g. an email subtitle). */
  subtitleHtml?: string;
  /** Optional HTML for the right-side actions (lang switcher, logout, session chip…). */
  rightHtml?: string;
  /** Optional class for the `<header>` wrapper. */
  wrapperClass?: string;
};

/**
 * Renders the shared FrameQ page header: a `<header>` containing the brand row
 * (brand mark + optional eyebrow / title / subtitle) and an optional right-side
 * actions slot. Pages pass their own localized title and right-side HTML, so the
 * brand block is defined once instead of copy-pasted across the four headers.
 */
export function renderFrameHeader(options: FrameHeaderOptions): string {
  const { eyebrow, title, titleId, subtitleHtml, rightHtml, wrapperClass } = options;
  const classAttr = wrapperClass ? ` class="${wrapperClass}"` : "";
  const idAttr = titleId ? ` id="${titleId}"` : "";
  const titleBlock = [
    eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : "",
    `<h1${idAttr}>${title}</h1>`,
    subtitleHtml ?? "",
  ]
    .filter(Boolean)
    .join("\n          ");
  const rightBlock = rightHtml ? `\n        ${rightHtml}` : "";
  return `      <header${classAttr}>
        <div class="brand-row">
          ${renderBrandMark()}
          <div>
            ${titleBlock}
          </div>
        </div>${rightBlock}
      </header>`;
}
