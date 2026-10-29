# Site Native Surface Redesign Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Apply the Oil Find reference system that the user reviewed and approved to the existing FrameQ marketing site: cool gray canvas, system typography, translucent white surfaces, restrained blue actions, and short spring feedback. Keep the three routes, real demo media, release metadata, local-first explanations, native video controls, and FAQ behavior.

## Progress

- [x] 2026-10-11: Inspected the site routes, shared styles, components, product spec, design decision, and execution gates; user explicitly approved the preceding extracted system for implementation. Validation: source inspection and conversation instruction.
- [x] 2026-10-11: Implemented shared tokens, centered hero, compact navigation, surface components, and all three pages. Validation: successful Astro static build; no undefined CSS token references; browser inspection.
- [x] 2026-10-11: Validated build, types, documentation, internal route/anchor links, responsive layouts, FAQ keyboard interaction, reduced motion, and JavaScript-disabled operation. Validation: commands and browser results below.

## Surprises & Discoveries

Evidence: `site/src/layouts/BaseLayout.astro` uses shared CSS and native controls for the approved interaction feedback. The three routes follow the Native Surface motion rules in `site/DESIGN.md`.

Evidence: The reference's white text on #2f7cf6 measures approximately 3.94:1. Small filled controls will use #1f66d6 (approximately 5.34:1), while #2f7cf6 remains the highlight and large-CTA color.

Evidence: A pre-existing `.gitignore` edit is outside this task. It must remain untouched.

## Decision Log

Decision: Adopt the previously extracted reference system rather than propose another theme. Rationale: User approved the system and requested implementation across `site`. Date/Author: 2026-10-11 / User + Codex.

Decision: Keep Astro SSG, existing component ownership, routes, media, and release data; replace styles in place and disconnect decorative effects. Rationale: The request concerns the visual system, not product/runtime behavior or deployment. Date/Author: 2026-10-11 / Codex.

Decision: Keep readable muted text stronger than the reference's 42% opacity. Rationale: Essential download and privacy notes must remain accessible. Date/Author: 2026-10-11 / Codex.

## Outcomes & Retrospective

All three local marketing routes now use the approved Native Surface system. The real demo video retains native controls, download links still target the three v0.3.8 artifacts, and FAQ interaction works without JavaScript. Decorative effect initialization, simulated window chrome, and web-font requests were removed.

Passed: `npm --prefix site run build` (3 pages and sitemap), site `npx --no-install tsc --noEmit`, documentation ERROR/WARN checks (zero findings), static HTML/route/anchor/metadata checks (3 routes, 42 links), 3 download URL checks, 6 FAQ entries, no script-src tags, no @font-face, and no undefined CSS tokens.

Browser evidence: all three routes at 320/375/414/768/1280px have no document overflow and no out-of-bounds main content. FAQ Enter opens the item with visible focus. Under reduced motion, panel animation is `none`, button transition is `0s`, and scrolling is `auto`. With page JavaScript disabled, hero and workflow are visible, all six FAQ items remain present, and Enter still opens FAQ. Testing overrides were restored.

Screenshots: `outputs/site-redesign-2026-10-11/home-desktop.png`, `home-mobile.png`, `download-desktop.png`, and `privacy-desktop.png`. The homepage screenshots use the final production build. The screenshot tool applied inconsistent viewport scaling; explicit CSS viewport capture through its documented CDP capability corrected the mobile evidence.

Not run: native Safari/macOS font-rendering checks and production deployment. Residual risk: system font rendering differs by OS; `site/` is already ignored by Git, so its source edits and dist build remain local unless deliberately included in a later distribution workflow. The pre-existing `.gitignore` change remains untouched.

## Context and Orientation

- Spec: `docs/product-specs/2026-08-05-web-marketing-site.md`.
- Design: `docs/design-docs/web-marketing-site-design.md`.
- Shared system: `site/src/styles/tokens.css`, `site/src/styles/global.css`.
- Shared layout: `site/src/layouts/BaseLayout.astro`.
- Pages: `site/src/pages/index.astro`, `download.astro`, `privacy.astro`.
- Components: `site/src/components/*.astro`; release data remains in `site/src/consts.ts`.

## Plan of Work

1. Update the existing spec and design decision with the approved visual direction and exceptions for contrast.
2. Define primitive, semantic, and component tokens for colors, typography, spacing, surfaces, buttons, and spring timing.
3. Apply tokens in shared base styling and remove decorative effect initialization. Content stays visible when JavaScript is unavailable.
4. Replace floating navigation and split hero with a compact bar and centered introduction. Present real video without an added simulated window frame.
5. Restyle workflow, trust explanations, output samples, sources, download cards, FAQ, footer, download page, and privacy page using the shared system.
6. Build, inspect emitted routes/assets, run type and documentation checks, and verify responsive behavior in a browser when available.

## Validation and Acceptance

- `npm --prefix site run build`: three routes and sitemap emitted successfully.
- `npm --prefix site exec -- tsc --noEmit`: site TypeScript checks pass (run with site working directory).
- `python scripts/validate_agents_docs.py --level ERROR` and `--level WARN`.
- Inspect all local links and v0.3.8 download URLs; check required content, metadata, video controls, and absence of decorative effect bundles/external font requests.
- Browser checks at 320, 375, 414, 768, and desktop widths: no horizontal overflow, readable content, usable navigation, FAQ keyboard toggle, visible focus, and reduced-motion/no-JS content visibility.
- Save desktop/mobile screenshots when browser tooling is available; record any unavailable checks explicitly.

## Results

- Build: exit 0; three pages emitted in 1.09s (Astro's reported build time).
- TypeScript: exit 0.
- Documentation: ERROR and WARN runs report 0 errors and 0 warnings.
- Contrast: small-action white/#1f66d6 approximately 5.34:1; secondary/muted text against #e6eaf0 approximately 5.00:1/4.70:1. Hero CTA uses 20px/700 type for its reference-blue fill.
- Self-review: Philosophy 5, Hierarchy 4, Execution 4, Specificity 4, Restraint 5, Variety 4. Reference-driven centered layout, system type, and subtle gray gradient are intentional user-approved exceptions to generic Hallmark style prohibitions; no blanket slop-test score is claimed.
