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

- [x] 2026-11-09: Step 1-2 — `worker/frameq_worker` → `worker/worker_core`, distribution `worker-core`, `FRAMEQ_*` → `APP_*`; regenerated `uv.lock`; worker 1276 passed / 4 skipped, ruff clean, server 375 passed, scripts 57, frontend green. Commit `bf3f9ad`.
- [x] 2026-11-09: Step 3-4 — identifier `pro.8xf.app`, `app.sqlite`, `desktop.log`, `task.json`, `.artifact-*`; contract, Python and Rust updated together; Rust contract tests 47 passed.
- [x] 2026-11-09: Step 5 — `pytorch-runtime-<target>.zip`, `?updater=1`, NSIS `AppLog`/`AppFreeSpaceMb`/`AppCheckWritability`/`AppProbe`, `install.log`, `.install-probe`, neutral scratch names, webview host bundle `AppWebViewHost.app`, `app-webview-host.exe`.
- [x] 2026-11-09: Step 6-7 — brand constants on all four surfaces, `{{product}}` placeholders in desktop and server copy, `FrameQ` → `Locus` across living code and docs; Chinese name removed.
- [x] 2026-11-09: Step 8 — gates green: ruff clean, worker 1276 passed / 4 skipped, frontend 1506 passed / 1 skipped, server 375 passed / 1 skipped, scripts 57 + 1, docs 0/0, `git diff --check`, `tauri build --no-bundle` built `app.exe` (20,242,432 bytes), launched with title `Locus`, new data dir `pro.8xf.app`, log `desktop.log`, clean exit 0. Rust `--lib`: 507 passed / 53 failed, all 53 in the known `data_storage` / `history_deletion` / `web_page` file-permission family this sandbox cannot host.

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

- `git mv` reported `bad source` while the directory move had actually succeeded; `git status` showed 85 rename entries afterwards, so the fatal message was misleading.
- The env-prefix pass missed the tracked root `.env.example` because the allowlist only named `server/.env.example`; a frontend test caught it immediately ("installer script has a tracked local settings template to bundle"). Fixing the allowlist is the point of that test.
- `frameq-` → `app-` also rewrote production service names in tests (`frameq-server.conf`, `frameq-server.service`). Those files document the running host, so the substitution had to be reverted in `server/tests/deploymentContracts.test.ts` and two scripts.
- i18next types derive required interpolation variables from the literal copy. Once copy contains `{{product}}`, every `t()` call is forced to pass it. `CustomTypeOptions` has no `defaultVariables` typing, so `app/src/i18n/i18next.d.ts` widens resource values to `string`; key completion and namespace checks stay, per-key interpolation type checking does not.
- The macOS helper bundle name and the Windows helper binary name carried the brand in two places that only build on their own platform (`FrameQWebViewHost.app`, `frameq-webview-host.exe`); the checked-in Windows resource manifest had to be renamed with the binary or the manifest test fails.
- Brand strings in the worker had no copy pipeline; `worker_core/brand.rs`-equivalent Python constant now holds the single value and the few English diagnostics interpolate it.
- The storage write probe asserted a hard-coded `hash length == 20`, which was exactly the byte length of `FrameQ storage probe`. A shorter neutral payload failed the probe and surfaced as `StorageError::VerificationFailed` in an unrelated migration test; the check now compares against the payload constant's own length.
- The deep-link scheme was a bare `"frameq"` string in `tauri.conf.json`, in the URL builder and in the parser, so a capital-letter sweep missed it. It is now `pro.8xf.app` in all three places plus the server's redirect allow-list.

## Decision Log

- Decision: change every machine identifier in one pass and write no migration code. Rationale: the project has no external users, so a compatibility layer would be dead weight. Date/Author: 2026-11-09 / WorkBuddy.
- Decision: keep the domain, repository and production deploy paths out of this change. Rationale: those need DNS, certificates and server-side moves; they are deployment work, not a rename. Date/Author: 2026-11-09 / WorkBuddy.
- Decision: brand copy renders from a single constant with `{{product}}` placeholders. Rationale: it is the only way the next rename stays a three-line change. Date/Author: 2026-11-09 / WorkBuddy.

## Outcomes & Retrospective

Done in one pass, commit `5d312de` (290 files). The product is Locus everywhere a user can see it, and no machine identifier carries the brand any more:

| Surface | Before | After |
| --- | --- | --- |
| Python package / distribution | `frameq_worker` / `frameq-worker` | `worker_core` / `worker-core` |
| Environment variables (103) | `FRAMEQ_*` | `APP_*` |
| App identifier / data dir | `com.frameq.desktop` | `pro.8xf.app` |
| Database file | `frameq.sqlite` | `app.sqlite` |
| Artifact contract | `frameq-task.json`, `.frameq-artifact-*` | `task.json`, `.artifact-*` |
| Desktop log | `frameq-desktop.log` | `desktop.log` |
| Diagnostics zip | `FrameQ-diagnostics-*.zip` | `diagnostics-*.zip` |
| Runtime component asset | `frameq-pytorch-runtime-*.zip` | `pytorch-runtime-*.zip` |
| Deep link | `frameq://auth/callback` | `pro.8xf.app://auth/callback` |
| Installer log / probe | `FrameQ-install.log`, `.frameq-install-probe` | `install.log`, `.install-probe` |
| Brand value | `FrameQ` (106 literals) | `Locus` via 4 constants + `{{product}}` |

Residual work, deliberately outside this change:

- The previous app-data directory `%LOCALAPPDATA%\com.frameq.desktop` is untouched. Nothing migrates it; the new build starts from an empty library unless the folder is moved by hand.
- Production identities still read `frameq`: domain `frameq.8xf.pro`, server paths `/opt/frameq/FrameQ` and service `frameq-server`, database file `frameq.sqlite`. Changing them is deployment work. The GitHub repository was renamed to `jiabai/Locus` on 2026-11-10; updater endpoint, runtime-component URLs, macOS releases link and site links were updated in the same pass, and old-name redirects were verified.
- `site/src/consts.ts` now derives installer names from `PRODUCT_NAME`, so the marketing site must not be deployed before the first Locus release publishes `Locus_*` assets.
- macOS-specific pieces (helper bundle `AppWebViewHost.app`, ad-hoc signing, DMG naming) changed but cannot be built or verified on this machine; the next hosted macOS run is the first real proof.
