# Rename to Locus and De-Brand Machine Identifiers

## Goal

Rename the product to Locus and remove the brand from every machine identifier, so the next rename costs three constants instead of a repository-wide sweep. Mapping table and constraints: `docs/product-specs/2026-11-09-project-rename-locus.md`. Naming rules: `docs/design-docs/2026-11-09-neutral-naming-policy.md`.

## Why this order

The de-branding pass must land before the brand switch. If the brand is replaced first, the sweep has to run twice and the second run has to distinguish "new brand" from "old internal identifiers". Doing identity first means the brand pass touches only copy and constants.

## Plan of Work

1. **Worker package** — `worker/frameq_worker/` → `worker/worker_core/`; `pyproject.toml` name → `worker-core`; regenerate `uv.lock`; update every `-m frameq_worker` spawn in Rust, the web-page ownership/session selectors, module-boundary tests, `scripts/verify-packaged-worker.mjs`, and `docs/ARCHITECTURE.md`.
2. **Environment prefix** — `FRAMEQ_` → `APP_` across worker, desktop Rust, frontend, server, build scripts, CI, `.env.example`, the first-run `.env` template in `app/src-tauri/src/settings.rs`, and the installer `.env.template`.
3. **App identity and data names** — identifier `com.frameq.desktop` → `pro.8xf.app`; `frameq.sqlite` → `app.sqlite`; `frameq-desktop.log` → `desktop.log`; `frameq-task.json` → `task.json`; `.frameq-artifact-*` → `.artifact-*`.
4. **Contract files (three-way)** — update `contracts/task-artifact-transaction-v1.json`, `worker/worker_core/task_transaction.py` and `app/src-tauri/src/task_manifest/transaction.rs` in one change, then run worker, Rust and script tests together.
5. **Release chain** — `pytorch-runtime-<target>.zip`, `?updater=1`, NSIS macros and `install.log` / `.install-probe`, temp fixture names, workflow asset paths.
6. **Brand single source** — add `app/src/brand.ts`, `server/src/brand.ts`; convert the 106 hardcoded brand literals in `app/src/i18n/**` to `{{product}}` and render from the constant; keep `site/src/consts.ts` as the site's single source and derive asset filenames from it.
7. **Brand switch** — set the constants and `productName` to Locus, drop 影问 from site copy, window title, README, living docs.
8. **Gates and local verification** — full gate set, `tauri build --no-bundle` launch check, generated `installer.nsi` compile.

## Progress

- [ ] Step 1-2: package and environment prefix.
- [ ] Step 3-4: identity, data names, contract files.
- [ ] Step 5: release chain.
- [ ] Step 6-7: brand constants and copy.
- [ ] Step 8: gates and local verification.

## Validation

- `git grep -i "frameq"` returns only the external identities listed in the spec.
- `git grep -i "影问"` returns nothing.
- `uv run ruff check worker`, `uv run pytest worker/tests`, `npm --prefix app test`, `npm --prefix app run build`,
  `npm --prefix server test`, `npm --prefix server run build`, `cargo test --manifest-path app/src-tauri/Cargo.toml`,
  `node --test scripts/tests/*.test.mjs`, `uv run python -m pytest scripts/tests`,
  `uv run python scripts/validate_agents_docs.py --level WARN`, `git diff --check`.
- The contract three-way check: run `uv run pytest worker/tests/test_task_transaction.py`, the Rust `task_manifest` tests and `node --test scripts/tests/*.test.mjs` in the same pass, since a one-sided artifact-name change makes journal recovery reject whole journals silently.
- `npm --prefix app run tauri -- build --no-bundle`, launch the binary, confirm the app opens with the new data directory and reads a fresh task.
- Compile the generated `installer.nsi` locally to confirm the NSIS macros still assemble.

## Surprises & Discoveries

- (pending)

## Decision Log

- Decision: change every machine identifier in one pass and write no migration code. Rationale: the project has no external users, so a compatibility layer would be dead weight. Date/Author: 2026-11-09 / WorkBuddy.
- Decision: keep the domain, repository and production deploy paths out of this change. Rationale: those need DNS, certificates and server-side moves; they are deployment work, not a rename. Date/Author: 2026-11-09 / WorkBuddy.
- Decision: brand copy renders from a single constant with `{{product}}` placeholders. Rationale: it is the only way the next rename stays a three-line change. Date/Author: 2026-11-09 / WorkBuddy.

## Outcomes & Retrospective

Pending.
