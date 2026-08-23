# Inspiration Profile / Generation Preference Boundary

## Status

- Date: 2026-08-05
- State: approved by user on 2026-08-05
- Scope: desktop Inspiration Profile, per-run generation preferences, app-local preference persistence, task-local preference snapshots, and worker prompt input
- Related product spec: `docs/product-specs/2026-07-06-personalized-insight-preferences.md`

## Problem

The current Inspiration Profile contains `defaultStyles` and `defaultAvoid`, while the six-step
generation flow contains the equivalent `styles` and `avoid` fields. FrameQ also persists the last
confirmed six-step selection as `defaultGenerationPreferences`. The result is three apparent
preference layers:

1. profile defaults;
2. saved generation defaults;
3. the current run's selection.

Although the worker currently tells the LLM to prefer `generationPreferences`, the product model and
confirmation UI still present overlapping values as peer facts. A user can therefore see two
different answers to the same question without a visible override rule. The duplicate fields also
force the frontend, Tauri validation, worker models, option registry, prompt snapshot, localization,
and tests to maintain two identities for the same semantic choice.

## Decision

FrameQ will keep a two-part model with one owner for each kind of information:

- **Inspiration Profile / long-term context** answers who the user is and which stable context should
  inform Inspiration.
- **Generation preferences / current direction** answer what the user wants from this generation.

The profile will no longer contain expression-style or avoidance defaults. The six-step generation
preference model is the only owner of `styles` and `avoid`. The existing
`defaultGenerationPreferences` remains a convenience snapshot that pre-fills the next run; it is not
a third semantic layer and is never sent separately from the current run's final selection.

## Alternatives Considered

### Hide duplicate profile rows only

Keep `defaultStyles` and `defaultAvoid` in persistence and worker contracts but stop rendering them.
This has the smallest immediate UI diff, but preserves conflicting sources and makes future prompt
behavior harder to reason about. Rejected.

### Add explicit inheritance and per-run overrides

Keep profile defaults and add `Use profile default` / `Override for this run` controls. This makes
precedence visible, but adds state, copy, and error cases to a compact desktop utility. It solves a
problem created by the model instead of removing the duplicate ownership. Rejected for current
scope.

### Remove duplicate fields from the profile

Make the profile stable context only and generation preferences the sole expression-control owner.
This reduces setup burden, removes prompt ambiguity, and matches the existing
`defaultGenerationPreferences` behavior. Selected.

## Target Product Model

### Long-term context

The v2 `InspirationProfile` contains exactly:

```json
{
  "role": "content_creator",
  "domain": "content_media",
  "stage": "experienced_professional",
  "cityContext": "new_tier1_city",
  "genderPerspective": "unspecified",
  "platforms": ["douyin", "xiaohongshu"]
}
```

The six fields describe relatively stable context:

| Field | Meaning |
|---|---|
| `role` | The user's general role |
| `domain` | The user's professional context |
| `stage` | The user's current life or career stage |
| `cityContext` | The user's geographic context |
| `genderPerspective` | An explicitly selected perspective, or unspecified |
| `platforms` | Platforms the user commonly works with |

`platforms` remains in the profile even though the run contains `scenario`. A platform is a
long-term ecosystem signal; a scenario is the concrete destination for the current output. The
worker may use the former as background, but the current `scenario` wins when they differ.

### Current generation direction

`GenerationPreferences` remains the complete six-step shape:

```json
{
  "goal": "content_creation",
  "scenario": "short_video",
  "angles": ["contrarian_view", "practical_advice"],
  "audience": "fans_readers",
  "styles": ["direct_sharp"],
  "avoid": ["clickbait"]
}
```

`styles` and `avoid` have no profile equivalents. The final confirmed object is the only expression
control sent to the worker for the run.

### Saved default generation preferences

`defaultGenerationPreferences` continues to store the last confirmed complete six-step selection.
Its behavior is unchanged:

- it pre-fills or shortcuts the next six-step flow;
- it updates only after the user confirms a billable Inspiration generation;
- cancelling or closing a draft does not update it;
- invalid saved values are cleared under the existing fail-closed rules;
- it is not reconstructed from task history;
- the worker receives the resolved current `generationPreferences`, not a separate default object.

The user-facing mental model is therefore **long-term context + this run's direction**. The saved
default is an interaction convenience, not another visible source of truth.

## User Experience

### Profile setup and settings

First-time profile setup contains six fields instead of eight. The introduction should describe
role, domain, context, and common platforms; it must not mention expression preferences. Settings
continues to provide edit and clear actions for the profile. Clearing the profile leaves
`defaultGenerationPreferences` and historical task artifacts unchanged.

The settings information architecture should use these meanings:

- `Inspiration Profile` / `灵感档案`: stable personal context;
- `Default generation preferences` / `默认生成偏好`: the saved six-step direction used to pre-fill
  a future run.

The two settings groups must not render the same style or avoidance tags.

### Generation flow

The six-step flow retains its current field order and validation. `styles` remains required with one
to two choices; `avoid` remains optional with up to three choices. Existing direct-generation and
change-direction entry points continue to use the complete saved generation defaults.

### Confirmation

The confirmation sheet gives the current direction stronger visual hierarchy than the profile:

1. `Preferences for this run` is the primary editable summary.
2. `Your long-term context` is a quieter secondary summary or collapsible group.
3. The profile summary contains only the six stable fields.
4. The current direction contains the six generation fields and output language.

The confirmation sheet must not show inheritance, conflict, or override copy because duplicate
ownership no longer exists. `platforms` and `scenario` may both appear because their labels and
meanings are distinct.

## Persistence

The app-local `insight-preferences.json` remains owned by Tauri and remains outside `.env`, the task
directory, and FrameQ server storage. The file uses the v2 shape with an explicit root
`schemaVersion: 2`. The app has no v1 file migration: FrameQ has shipped only the v2 format since the
Inspiration Profile feature launched, so every persisted preference file is already v2. New installs
and every save write the v2 shape directly; no legacy `defaultStyles`/`defaultAvoid` fields and no
`legacyGenerationPreferenceSeed` migration seed exist.

Historical task-local `preference-snapshot.json` files are immutable evidence of past runs. They may
retain v1 profile fields and label snapshots. History display may render those historical labels,
but no historical snapshot may update the v2 global profile or current defaults.

## Desktop and Worker Contract

New task-local preference snapshots and retry payloads use the v2 profile shape. TypeScript, Rust,
and Python `InspirationProfile` models remove `defaultStyles` and `defaultAvoid`. The shared option
registry removes the profile-scoped versions while retaining generation-scoped `styles` and `avoid`.

The prompt receives one compact object with:

- `profile`: stable context or null;
- `profileSkipped`: the existing explicit skip meaning;
- `generationPreferences`: the complete current direction;
- `labelSnapshot`: labels for those exact v2 fields.

Prompt instructions should no longer say to prefer generation preferences over profile expression
defaults because those defaults no longer exist. They should retain the narrower rule that current
`scenario` is authoritative for this run when it differs from a common platform context. Transcript
evidence continues to win over every preference.

No request or persistence field is added to FrameQ server. Summary, Mermaid mindmap, transcript
dissection, ASR, model download, and media preparation remain unchanged.

## Privacy and Failure Boundaries

- Profile, defaults, and current drafts remain local until the user confirms
  Inspiration generation.
- Only the resolved v2 profile and complete current generation preferences may enter the Inspiration
  worker request.
- The v2 preference state must not appear in logs, diagnostics, server requests, quota metadata, or
  worker command diagnostics beyond the confirmed worker request payload.
- Existing clear-profile behavior affects future generation only and must not delete task-local
  snapshots or generated artifacts.
- Invalid or partially migrated data must fail closed; it must never become an inferred persona or
  implicit expression style.

## Implementation Boundaries

Expected implementation surfaces are limited to:

- product spec, architecture/design guidance, active ExecPlan, and option-contract documentation;
- TypeScript profile types, validation, summaries, flow state, forms, localization, and tests;
- Tauri app-local schema validation, atomic migration, commands, and tests;
- Rust retry payload and task snapshot serialization;
- Python request parsing, profile models, prompt formatting, and tests;
- shared desktop-worker preference contracts and bundled worker synchronization where applicable.

The work must not add free-text profile fields, learned profiles, account sync, server persistence,
historical backfill, new AI targets, new billable calls, or a general preference inheritance engine.

## Verification and Acceptance

### Automated

- TypeScript tests prove v2 profiles reject deprecated fields at public validation boundaries, show
  only six profile fields, preserve six-step generation behavior, and build snapshots without
  duplicate style/avoid labels.
- Rust tests cover v2 load/save/clear/skip semantics, schema validation, rejection of unknown or
  malformed preference fields, and preservation of unrelated app-local preference state.
- Worker tests prove v2 request parsing, prompt serialization, and absence of profile-scoped style or
  avoid fields; summary, mindmap, and dissection prompts remain unaffected.
- Contract tests prove TypeScript, Rust, and Python agree on the v2 snapshot shape.
- Existing frontend, Rust, worker, governance, lint, and production-build gates pass.

### Manual

- A new user sees six profile fields, then the unchanged six-step run flow.
- Confirmation visually prioritizes the current run and shows a quieter six-field long-term context.
- Clearing the profile leaves generation defaults and historical task artifacts unchanged.
- A confirmed Inspiration request contains one v2 profile and one complete current direction; no
  migration seed or duplicate expression field crosses the worker boundary.

## Rollout and Residual Risk

This feature shipped directly on the v2 schema, so there is no v1-to-v2 migration and no
`legacyGenerationPreferenceSeed` to preserve. The residual risk is accidental introduction of a
deprecated field or a third preference source; the v2-only load path fails closed on unknown fields
and the shared registry owns the single `styles`/`avoid` source. Historical task snapshots remain
mixed-version by design, so history rendering must continue to tolerate their frozen v1 label
snapshots without treating them as current state.

No code implementation begins until this design is approved and the product spec plus active
ExecPlan are updated and reviewed.
