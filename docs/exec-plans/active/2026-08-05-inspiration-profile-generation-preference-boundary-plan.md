# Inspiration Profile / Generation Preference Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlapping eight-field Inspiration Profile with a six-field v2 long-term context, make the six-step generation preferences the sole owner of style and avoidance controls, and migrate released v1 app-local preferences without changing historical task artifacts or server boundaries.

**Architecture:** Tauri owns a versioned, atomically migrated `insight-preferences.json`; TypeScript owns the six-field UI model and edit-only migration-seed prefill; Rust and Python carry only the resolved v2 profile plus complete current generation preferences across the retry boundary. Existing v1 task-local snapshots remain immutable historical evidence.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, Rust/Serde, Python 3.13 dataclasses/pytest, JSON desktop-worker contracts, Markdown governance documents.

---

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Users will set only stable background information in `Inspiration Profile`: role, professional
domain, stage, location context, perspective, and usual platforms. Expression style and directions
to avoid will appear only in `Preferences for this run`, where the last confirmed complete selection
may still pre-fill the next run. The confirmation sheet will prioritize the current run and show the
profile as quieter long-term context, with no duplicate style or avoidance tags.

Existing v1 app-local files migrate locally and atomically. A complete saved generation default
remains authoritative; otherwise deprecated profile style/avoid values become a one-time partial
seed that can only pre-fill the next edit flow. Server APIs, AI Credit accounting, summary, mindmap,
transcript dissection, media processing, and historical task artifacts do not change.

## Progress

- [x] 2026-08-05: User approved the six-field Profile v2 boundary and migration design. Validation: approval recorded in `docs/design-docs/2026-08-05-inspiration-profile-generation-preference-boundary.md`.
- [x] 2026-08-05: Updated the personalized-insight product spec, drafted this active implementation plan, and synchronized product/plan/AGENTS/TASKS entry points. Validation: `python scripts/validate_agents_docs.py --level WARN` passed with 0 errors and 0 warnings; `git diff --check` passed with line-ending notices only.

## Surprises & Discoveries

- Evidence: `app/src/insightPreferences.ts`, `app/src-tauri/src/insight_preferences.rs`, and
  `worker/frameq_worker/models.py` each model profile-scoped style and avoidance fields, so hiding
  form rows alone would leave an inconsistent cross-language contract.
- Evidence: `app/src/insightPreferenceFlow.ts` enables `Generate now` only from complete
  `defaultGenerationPreferences`; a partial seed can remain separate and edit-only.
- Evidence: `app/src-tauri/src/insight_preferences.rs` currently uses `fs::write`, while
  `app/src-tauri/src/atomic_files.rs` provides the reviewed repository `atomic_write`; migration
  must reuse the shared writer.
- Evidence: task-local `ai/preference-snapshot.json` may contain frozen v1 labels and cannot be used
  to derive global state under the existing local-first security boundary.
- Evidence: profile removal and the new long-term-context heading require reviewed Simplified
  Chinese, Traditional Chinese, and US English resources and tests.

## Decision Log

- Decision: Remove `defaultStyles` and `defaultAvoid` from the current profile contract instead of
  hiding them. Rationale: only generation preferences should own expression controls. Date/Author:
  2026-08-05 / User + Codex.
- Decision: Add root `schemaVersion: 2` to global app-local preferences while leaving task-local
  historical snapshots unchanged. Rationale: released global state needs deterministic migration;
  history must remain immutable evidence. Date/Author: 2026-08-05 / User + Codex.
- Decision: Preserve deprecated values only as optional edit-only
  `legacyGenerationPreferenceSeed` when no complete saved default exists. Rationale: prevent silent
  loss without creating a worker-visible third preference source. Date/Author: 2026-08-05 / User + Codex.
- Decision: Allow the migration seed to retain up to three v1 style ids, while current generation
  preferences still permit only one or two. Rationale: three styles were valid in Profile v1;
  truncating them would silently lose user choices, so the style step must require explicit reduction
  before completion. Date/Author: 2026-08-05 / Codex.
- Decision: Reuse `crate::atomic_files::atomic_write` for every preferences-file write. Rationale:
  failed migration must retain original bytes. Date/Author: 2026-08-05 / Codex.
- Decision: Do not add server fields, account sync, history-derived defaults, free-text fields, or a
  general inheritance engine. Rationale: all are outside the approved scope. Date/Author: 2026-08-05 / User + Codex.

## Outcomes & Retrospective

Planned outcome: one six-field long-term profile, one complete current generation direction, local
v1-to-v2 migration, and no duplicate style/avoid values in confirmation or prompts. Exact automated
totals and manual evidence will be recorded during implementation.

Residual risk before implementation: released v1 files may contain combinations absent from current
fixtures, and native packaged migration/layout behavior remains unverified until the matrix and gates
below run.

## Context and Orientation

- Design/spec: `docs/design-docs/2026-08-05-inspiration-profile-generation-preference-boundary.md`, `docs/product-specs/2026-07-06-personalized-insight-preferences.md`.
- TypeScript domain/flow: `app/src/insightPreferences.ts`, `app/src/insightPreferencePromptSemantics.ts`, `app/src/insightPreferenceFlow.ts`, `app/src/insightPreferencesClient.ts`.
- UI/i18n: `app/src/features/insightPreferences/InspirationProfileForm.tsx`, `app/src/features/insightPreferences/InsightPreferenceFlow.tsx`, `app/src/features/settings/SettingsSheet.tsx`, `app/src/i18n/preferenceResources.ts`.
- Tauri: `app/src-tauri/src/insight_preferences.rs`, `app/src-tauri/src/atomic_files.rs`, `app/src-tauri/src/video_processing/retry_insights.rs`.
- Worker: `worker/frameq_worker/models.py`, `worker/frameq_worker/requests.py`, `worker/frameq_worker/insightflow/prompt.py`.
- Contract/runtime: `contracts/desktop-worker-contract.json`, `scripts/tauri-dev-fresh-worker.mjs`, `app/src-tauri/resources/worker/`.
- Focused tests: `app/src/insightPreferences.test.ts`, `app/src/insightPreferenceFlow.test.ts`, `app/src/insightPreferencesClient.test.ts`, `app/src/i18n/preferencePresentation.test.ts`, `app/src/features/insightPreferences/InsightPreferenceFlow.test.tsx`, `app/src/workerClient.test.ts`, Rust inline tests, `worker/tests/test_requests.py`, and `worker/tests/test_insights.py`.

## File Structure and Ownership

- `app/src/insightPreferences.ts` owns current v2 option identity, strict validation, and snapshot
  construction; it does not parse v1 persistence.
- `app/src/insightPreferencesClient.ts` strictly decodes the Tauri v2 state and optional seed.
- `app/src/insightPreferenceFlow.ts` applies an edit-only seed but never treats it as complete defaults.
- `app/src-tauri/src/insight_preferences.rs` solely owns v1 detection, v2 migration, seed lifecycle,
  and atomic global persistence.
- `worker/frameq_worker/requests.py` accepts only current v2 snapshots; it does not migrate global or
  historical data.

## Plan of Work

### Task 1: Make the TypeScript Domain Profile-v2-only

**Files:**
- Modify: `app/src/insightPreferences.test.ts`
- Modify: `app/src/insightPreferences.ts`
- Modify: `app/src/insightPreferencePromptSemantics.ts`
- Modify: `app/src/i18n/preferencePresentation.test.ts`
- Modify: `app/src/i18n/preferencePresentation.ts`

- [ ] **Step 1: Write failing v2 profile and snapshot tests**

```ts
const PROFILE_V2: InspirationProfile = {
  role: "content_creator",
  domain: "content_media",
  stage: "experienced_professional",
  cityContext: "new_tier1_city",
  genderPerspective: "unspecified",
  platforms: ["douyin"],
};
expect(validateInspirationProfile(PROFILE_V2)).toEqual(PROFILE_V2);
expect(validateInspirationProfile({ ...PROFILE_V2, defaultStyles: ["direct_sharp"] })).toBeNull();
expect(JSON.stringify(buildPreferenceSnapshot({
  profile: PROFILE_V2,
  profileSkipped: false,
  generationPreferences: VALID_GENERATION_PREFERENCES,
}))).not.toMatch(/defaultStyles|defaultAvoid/);
```

Update three-locale summary tests to allow only the six v2 fields.

- [ ] **Step 2: Run RED**

```powershell
npm --prefix app test -- insightPreferences.test.ts preferencePresentation.test.ts
```

Expected: compile/test failure because profile types and validation still require deprecated fields.

- [ ] **Step 3: Implement the exact six-field contract**

```ts
export type ProfileField =
  | "role" | "domain" | "stage" | "cityContext" | "genderPerspective" | "platforms";
export type InspirationProfile = {
  role: string;
  domain: string;
  stage: string;
  cityContext: string;
  genderPerspective: string;
  platforms: string[];
};
export const PROFILE_FIELD_ORDER: ProfileField[] = [
  "role", "domain", "stage", "cityContext", "genderPerspective", "platforms",
];
```

Remove profile-scoped configs/semantics. Before value validation, compare sorted `Object.keys(value)`
with `PROFILE_FIELD_ORDER` so extra deprecated keys fail closed. Keep generation `styles`/`avoid` unchanged.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2, then commit only these files with `refactor: narrow inspiration profile contract`.

### Task 2: Add Atomic Tauri Schema-v2 Migration

**Files:**
- Modify: `app/src-tauri/src/insight_preferences.rs`
- Reuse: `app/src-tauri/src/atomic_files.rs`

- [ ] **Step 1: Write the failing migration matrix**

Add Rust tests named:

```rust
migrates_v1_profile_and_keeps_complete_generation_defaults
migrates_v1_profile_values_to_edit_only_seed_without_defaults
invalid_v1_profile_requires_reset_without_partial_migration
confirmed_generation_defaults_remove_migration_seed_atomically
clearing_profile_removes_unconfirmed_migration_seed
failed_atomic_replacement_preserves_original_preferences
```

Assert schema 2, exact six-field output, seed precedence/lifecycle, original-byte retention, and no
history-directory access.

- [ ] **Step 2: Run RED**

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml insight_preferences
```

Expected: compile/test failure because versioned DTOs, seed, and migration do not exist.

- [ ] **Step 3: Define strict current and legacy-only DTOs**

```rust
const INSIGHT_PREFERENCES_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InspirationProfile {
    pub(crate) role: String,
    pub(crate) domain: String,
    pub(crate) stage: String,
    pub(crate) city_context: String,
    pub(crate) gender_perspective: String,
    pub(crate) platforms: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LegacyGenerationPreferenceSeed {
    pub(crate) styles: Vec<String>,
    pub(crate) avoid: Vec<String>,
}
```

Use a private `LegacyInspirationProfileV1` containing the two deprecated arrays. The v2 root and state
view add optional `legacy_generation_preference_seed`; never map it to complete defaults.

- [ ] **Step 4: Implement validate-first atomic migration**

Distinguish missing schema version from v2, validate the chosen full shape, then atomically serialize:

```rust
use crate::atomic_files::atomic_write;

fn write_preferences_file(path: &Path, file: &InsightPreferencesFileV2) -> Result<(), String> {
    let bytes = (serde_json::to_string_pretty(file).map_err(|_| "Preference save failed.")? + "\n")
        .into_bytes();
    atomic_write(path, &bytes).map_err(|_| "Preference save failed.".to_string())
}
```

Keep complete valid defaults; otherwise derive a seed only from non-empty valid legacy arrays.
Saving complete defaults and clearing profile remove the seed. New profile saves never create one.

- [ ] **Step 5: Run GREEN, format, and commit**

```powershell
cargo test --manifest-path app/src-tauri/Cargo.toml insight_preferences
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
```

Commit with `feat: migrate inspiration preferences to schema v2`.

### Task 3: Decode the Seed and Update the Desktop Flow

**Files:**
- Modify: `app/src/insightPreferencesClient.ts`
- Modify: `app/src/insightPreferencesClient.test.ts`
- Modify: `app/src/insightPreferenceFlow.ts`
- Modify: `app/src/insightPreferenceFlow.test.ts`
- Modify: `app/src/features/insightPreferences/InspirationProfileForm.tsx`
- Modify: `app/src/features/insightPreferences/InsightPreferenceFlow.tsx`
- Modify: `app/src/features/insightPreferences/InsightPreferenceFlow.test.tsx`
- Modify: `app/src/features/insightPreferences/useInsightGenerationController.test.ts`
- Modify: `app/src/features/settings/SettingsSheet.tsx`
- Modify: `app/src/i18n/preferenceResources.ts`

- [ ] **Step 1: Write failing IPC, flow, and UI tests**

Decode a seed `{ styles: ["direct_sharp"], avoid: ["clickbait"] }`; reject extra keys, invalid ids,
duplicates, and cardinality violations. With no complete defaults, assert the flow starts at
`generation_step` with only styles/avoid seeded and required earlier fields empty. With complete
defaults, assert defaults win. Render all locales and prove six profile fields plus one current-run
style/avoid group.

- [ ] **Step 2: Run RED**

```powershell
npm --prefix app test -- insightPreferencesClient.test.ts insightPreferenceFlow.test.ts InsightPreferenceFlow.test.tsx useInsightGenerationController.test.ts
```

Expected: failures because state/flow still lack the seed and form fixtures require eight fields.

- [ ] **Step 3: Implement strict seed decoding and edit-only prefill**

```ts
export type LegacyGenerationPreferenceSeed = { styles: string[]; avoid: string[] };
```

Add it as nullable state. Validate with generation-scoped ids, legacy style max 3, and avoid max 3. In
`createInsightPreferenceFlow`, complete defaults take precedence; otherwise copy the seed into the
empty six-step draft. If the seed has three styles, the existing current-generation validation must
keep Step 5 blocked until the user reduces it to one or two. A seed never selects `default_summary`
or enables `Generate now`.

- [ ] **Step 4: Remove duplicate form rows and revise hierarchy**

Remove deprecated fields from `EMPTY_PROFILE`. Add reviewed
`longTermContextGroupTitle` resources. Render final confirmation as current generation summary first,
then a quiet long-term-context summary. Reuse existing quiet tokens; add no gradients, motion, new
modal, or extra card stack. Settings retains the `Inspiration Profile` name.

- [ ] **Step 5: Run GREEN and commit**

Run Step 2 and commit with `feat: separate long-term context from run preferences`.

### Task 4: Narrow the TypeScript/Rust Retry Contract

**Files:**
- Modify: `app/src/workerClient.test.ts`
- Modify: `app/src/workerClient.ts`
- Modify: `app/src-tauri/src/video_processing/retry_insights.rs`
- Modify: `contracts/desktop-worker-contract.json`

- [ ] **Step 1: Write failing exact-payload tests**

Assert `preference_snapshot.profile` exactly contains the six v2 keys. Assert current retry examples
contain no `defaultStyles`, `defaultAvoid`, or `legacyGenerationPreferenceSeed`.

- [ ] **Step 2: Run RED**

```powershell
npm --prefix app test -- workerClient.test.ts
cargo test --manifest-path app/src-tauri/Cargo.toml retry_insights
```

Expected: existing fixtures/serialization still contain deprecated keys.

- [ ] **Step 3: Update current DTOs and contract examples**

Use the exact Task 1 profile with no aliases. Limit profile label rows to current fields. Keep
`generationPreferences`, `profileSkipped`, billing, output language, and retry target behavior unchanged.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2 and commit with `refactor: send profile v2 in inspiration retries`.

### Task 5: Remove Duplicate Semantics from the Python Worker

**Files:**
- Modify: `worker/tests/test_requests.py`
- Modify: `worker/tests/test_insights.py`
- Modify: `worker/frameq_worker/models.py`
- Modify: `worker/frameq_worker/requests.py`
- Modify: `worker/frameq_worker/insightflow/prompt.py`

- [ ] **Step 1: Write failing strict-parser and prompt tests**

Use six-field fixtures. Assert a current request with deprecated/extra profile keys raises
`ValueError`. Assert formatted prompts contain generation styles/avoid but no profile equivalents,
and state that current scenario wins over common platform while transcript facts win over everything.

- [ ] **Step 2: Run RED**

```powershell
uv run pytest worker/tests/test_requests.py worker/tests/test_insights.py -q
```

Expected: model construction or exact-key assertions fail.

- [ ] **Step 3: Implement exact v2 model/parser**

```python
@dataclass(frozen=True)
class InspirationProfile:
    role: str
    domain: str
    stage: str
    city_context: str
    gender_perspective: str
    platforms: tuple[str, ...] = ()
```

`to_dict()` emits exactly six camelCase keys. Remove deprecated registry entries. Before reading
values require the exact key set; missing or unexpected keys raise a stable non-echoing `ValueError`.

- [ ] **Step 4: Simplify prompt precedence**

Remove broad duplicate-source precedence copy. Add: `profile.platforms` is background; current
`generationPreferences.scenario` wins when different; transcript evidence always wins. Do not change
summary, mindmap, or dissection builders.

- [ ] **Step 5: Run GREEN, Ruff, and commit**

```powershell
uv run pytest worker/tests/test_requests.py worker/tests/test_insights.py -q
uv run ruff check worker/frameq_worker/models.py worker/frameq_worker/requests.py worker/frameq_worker/insightflow/prompt.py worker/tests/test_requests.py worker/tests/test_insights.py
```

Commit with `refactor: remove duplicate profile prompt preferences`.

### Task 6: Synchronize Runtime and Run Cross-layer Gates

**Files:**
- Refresh: `app/src-tauri/resources/worker/`
- Modify: any current-contract fixtures found by exact deprecated-field search

- [ ] **Step 1: Refresh the packaged worker**

```powershell
node scripts/tauri-dev-fresh-worker.mjs
```

Expected: exit 0 and mirrored Python sources match `worker/frameq_worker`; do not hand-copy them.

- [ ] **Step 2: Prove duplicate runtime fields are gone**

```powershell
rg -n "defaultStyles|defaultAvoid|default_styles|default_avoid" app/src app/src-tauri/src worker/frameq_worker contracts
```

Expected: matches only in explicitly named v1 migration DTOs/tests, never current runtime contracts.

- [ ] **Step 3: Run complete automated gates**

```powershell
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
uv run pytest worker/tests
uv run ruff check worker
node --test scripts/tests/*.test.mjs
python scripts/validate_agents_docs.py --level WARN
git diff --check
```

Expected: every command exits 0. Record exact totals, skips, warnings, and unavailable evidence.

- [ ] **Step 4: Run the manual migration/UI matrix**

With disposable app-local data, verify: new install; v1 plus complete defaults; v1 without defaults;
invalid v1; current-first confirmation in three locales; six-field retry serialization; clear profile
preserving complete defaults and history. Do not consume a real AI Credit merely to inspect payloads.

- [ ] **Step 5: Commit synchronized resources and regression fixes**

Inspect `git diff --cached --name-only`; commit only plan-related files with
`test: verify inspiration preference boundary migration`.

### Task 7: Complete Governance and Archive

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/SECURITY.md` only if security statements need clarification
- Modify: `TASKS.md`, `AGENTS.md`, active/completed plan indexes
- Move: this plan from `active/` to `completed/`

- [ ] **Step 1: Update persistent guidance**

Record six-field profile ownership, generation-only expression controls, schema v2 migration, atomic
writer, edit-only seed, worker shape, and immutable historical snapshots without duplicating option tables.

- [ ] **Step 2: Fill living-document evidence**

Append dated Progress entries ending in `Validation: ...`; update discoveries/decisions; replace
planned Outcomes with exact results and residual risks.

- [ ] **Step 3: Complete and archive only after gates pass**

Mark the task complete, move the plan, update both plan indexes and AGENTS quick entries.

- [ ] **Step 4: Run final documentation checks**

```powershell
python scripts/validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Expected: 0 governance errors/warnings; clean diff; only intended changes plus pre-existing user-owned changes.

- [ ] **Step 5: Commit governance completion**

Commit with `docs: complete inspiration preference boundary plan`.

## Validation and Acceptance

### Focused commands

```powershell
npm --prefix app test -- insightPreferences.test.ts preferencePresentation.test.ts insightPreferencesClient.test.ts insightPreferenceFlow.test.ts InsightPreferenceFlow.test.tsx useInsightGenerationController.test.ts workerClient.test.ts
cargo test --manifest-path app/src-tauri/Cargo.toml insight_preferences
cargo test --manifest-path app/src-tauri/Cargo.toml retry_insights
uv run pytest worker/tests/test_requests.py worker/tests/test_insights.py -q
```

### Complete gates

Use every command listed in Task 6 Step 3.

### Acceptance criteria

- New/edited profiles expose exactly six stable fields; profile snapshots/prompts contain no
  profile-scoped style or avoid fields.
- Valid v1 global files migrate atomically to schema v2; existing complete defaults survive.
- Partial migration seed is edit-only, never enables direct generation, never crosses the worker
  boundary, preserves up to three valid v1 styles without truncation, requires explicit reduction to
  the current maximum of two, and is removed after confirmed complete defaults or profile clearing.
- Invalid v1 profiles remain reset-required and do not become inferred personas.
- Confirmation is current-run-first and duplicate-free in all three locales.
- Current retry payloads contain one six-field profile plus one complete generation object; current
  scenario wins over common platform and transcript facts remain authoritative.
- Historical v1 task snapshots remain untouched and never update global state.
- Summary, mindmap, dissection, Credits, server, ASR, model download, and media behavior are unchanged.
- All focused and complete gates pass; unavailable native or paid evidence is recorded as residual risk.
