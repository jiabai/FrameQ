# Transcript Dissection Markdown Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ai/dissection.md` a complete, localized human-readable projection of the existing
structured transcript-dissection report.

**Architecture:** Keep `TranscriptDissection` and JSON schema version 1 authoritative. Extend only
the deterministic Markdown formatter and its tests; do not change generation, persistence, quota,
privacy, UI, or source-location contracts.

**Tech Stack:** Python 3, pytest, Ruff.

---

## Progress

- [x] 2026-08-01: Confirmed the formatter omits user-visible fields required by the product spec.
- [x] 2026-08-01: User approved complete three-language Markdown projection with no schema change.
- [x] Task 1: Added RED completeness and optional/empty-field tests.
- [x] Task 2: Implemented the complete localized formatter.
- [x] Task 3: Ran verification, recorded evidence, and archived.

## Decisions

- Preserve report and artifact schemas; this is a projection bug, not a data-model gap.
- Omit optional narrative rows and empty list sections instead of emitting placeholders.
- Localize fixed headings and `audienceFit.fit`; preserve generated report values unchanged.
- Export source chunk IDs for human traceability, but exclude hashes, byte ranges, schema metadata,
  paths, prompts, and copied source chunks.

## Task 1: RED Tests

**Files:**

- Modify: `worker/tests/test_dissection.py`

- [x] Add a parameterized `zh-CN` / `zh-TW` / `en-US` test that renders a complete report and
  asserts every semantic value plus locale-specific headings and fit labels are present.
- [x] Assert provenance hashes, byte ranges, schema version, and transcript-only text are absent.
- [x] Add a test proving null narrative values and empty lists do not create empty headings.
- [x] Run the focused suite and record four expected failures against the abbreviated formatter.

## Task 2: Complete Formatter

**Files:**

- Modify: `worker/frameq_worker/insightflow/dissection.py`
- Modify: `worker/tests/test_dissection.py`

- [x] Replace the positional label tuple with a closed locale label mapping covering every heading,
  field label, source reference label, and audience-fit enum.
- [x] Render narrative, segments, template, highlights, audience fit, strengths, and weaknesses in
  stable report order while omitting only absent optional/empty values.
- [x] Keep the formatter as plain Markdown generation and add no raw HTML.
- [x] Run focused pytest and Ruff until green (`31 passed`; Ruff passed).

## Task 3: Verification and Closure

- [x] Run `uv run pytest worker/tests/test_dissection.py -q` (`31 passed`).
- [x] Run the complete worker suite with a repository-local `--basetemp` (`669 passed, 2 skipped`).
- [x] Run `uv run ruff check worker` (`All checks passed`).
- [x] Run `python scripts/validate_agents_docs.py --level WARN` (0 errors, 0 warnings).
- [x] Run `git diff --check`, inspect the scoped diff, record evidence, and archive this plan.

## Outcomes

The Markdown artifact now renders all four narrative values, every segment semantic field and
source chunk reference, reusable template, highlights, all three localized audience-fit enum
values, strengths, and weaknesses. Optional narrative values and empty list sections are omitted.
Tests also prove that provenance hashes, byte ranges, schema metadata, and uncited transcript-only
text are absent.

TDD evidence: the initial formatter produced four expected completeness/empty-section failures.
A separate controlled mapping removal then produced three `fit_medium` failures, proving the
high/medium/low localization coverage before the mappings were restored. Final evidence: focused
`31 passed`; full worker `669 passed, 2 skipped` with one existing `audioop` deprecation warning;
full Ruff passed; governance reported 0 errors and 0 warnings; `git diff --check` exited 0.

## Acceptance Criteria

- All user-visible fields in report schema version 1 appear in Markdown when populated.
- Fixed labels and audience-fit values are correct in Simplified Chinese, Traditional Chinese, and
  US English; generated values and highlight quotations are not translated or rewritten.
- Null optional narrative fields and empty arrays do not create misleading placeholders or empty
  sections.
- Internal provenance, paths, prompts, schema metadata, source text copies, and unrelated artifacts
  remain absent.
- JSON authority, artifact paths/transactions, UI, staleness, location, generation, quota, and
  privacy boundaries are unchanged.
