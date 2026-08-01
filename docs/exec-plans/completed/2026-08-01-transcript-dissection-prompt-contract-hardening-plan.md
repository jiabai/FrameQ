# Transcript Dissection Prompt Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every transcript-dissection LLM stage receive enough exact, bounded instructions to
produce or repair the existing closed report schema reliably.

**Architecture:** Keep schema version 1 and the six-call plan unchanged. Centralize human-readable
map and final schema contracts in `prompt.py`; pass only sorted legal chunk IDs plus a fixed safe
validation category to repair. Preserve the existing rule that raw transcript text appears only in
map prompts.

**Tech Stack:** Python 3, pytest, Ruff, existing FrameQ managed LLM client.

---

## Progress

- [x] 2026-08-01: Compared the live prompt builders with the strict parser and the external video
  dissection reference; confirmed that only its explicit instruction style is relevant.
- [x] 2026-08-01: User approved prompt-only hardening without schema, quota, privacy, or video-input
  expansion.
- [x] Task 1: Added failing prompt-contract tests and recorded five expected RED failures.
- [x] Task 2: Implemented exact map/reduce/repair prompts and safe repair context.
- [x] Task 3: Ran focused and full worker verification, synchronized durable docs, and archived.

## Decision Log

- Decision: Preserve report schema version 1 and call-plan version 1. Rationale: the defect is a
  mismatch between instructions and an already-correct strict parser, not a missing product field.
  Date/Author: 2026-08-01, User + Codex.
- Decision: Use a fixed safe validation category rather than exception text in repair prompts.
  Rationale: parser internals and source content must not leak, while the model still needs to know
  whether shape, references, quotation provenance, limits, or enum values failed.
  Date/Author: 2026-08-01, Codex.
- Decision: Keep raw transcript chunks out of reduce and repair. Rationale: existing privacy tests
  and bounded map/reduce data flow already minimize repeated source transmission.
  Date/Author: 2026-08-01, Codex.

## Task 1: Add RED Prompt-Contract Tests

**Files:**

- Modify: `worker/tests/test_dissection.py`

- [x] Import the three prompt builders and assert the map prompt declares exact intermediate keys,
  all segment dimensions, legal batch chunk IDs, JSON-only output, and bounded arrays.
- [x] Assert the reduce prompt declares every final nested key, `high|medium|low`, nullability,
  sequential IDs, quotation provenance, and all existing parser limits.
- [x] Assert the repair prompt explicitly permits adding required schema fields, forbids new facts,
  quotations and illegal chunk IDs, includes legal IDs plus a safe category, and includes no raw
  transcript text.
- [x] Run `uv run pytest worker/tests/test_dissection.py -q` and record the expected assertion
  failures against the current underspecified prompts.

## Task 2: Implement Exact Prompt Contracts

**Files:**

- Modify: `worker/frameq_worker/insightflow/prompt.py`
- Modify: `worker/frameq_worker/insightflow/dissection.py`
- Modify: `worker/tests/test_dissection.py`

- [x] Add focused private helpers/constants that render the map and final JSON examples without
  changing runtime DTOs or the public report schema.
- [x] Rewrite map and reduce instructions around the exact schemas and content rules.
- [x] Classify strict-parser failures into a closed safe repair category and pass the sorted legal
  chunk IDs to `build_dissection_repair_prompt`.
- [x] Preserve at most one repair call, cancellation checks, checkout behavior, and transcript-free
  reduce/repair prompts.
- [x] Run the focused test and Ruff checks until green.

## Task 3: Verification and Closure

**Files:**

- Modify: `docs/product-specs/2026-07-31-transcript-dissection.md`
- Modify: `docs/design-docs/2026-07-31-transcript-dissection-feature.md`
- Modify: this ExecPlan and its indexes
- Move after all gates pass: this file to `docs/exec-plans/completed/`

- [x] Run `uv run pytest worker/tests/test_dissection.py -q` (`27 passed`).
- [x] Run `uv run pytest worker/tests -q` with a worktree-local `--basetemp` if the managed Windows
  user temp root is inaccessible.
- [x] Run `uv run ruff check worker` (`All checks passed`).
- [x] Run `python scripts/validate_agents_docs.py --level WARN` (0 errors, 0 warnings).
- [x] Run `git diff --check` and inspect the scoped diff for raw source content, URLs, keys, paths,
  or changes to unrelated user files.
- [x] Record exact evidence and residual live-supplier risk, then archive the plan.

## Outcomes

The map prompt now declares a four-key intermediate object and all eight segment analysis fields,
legal batch references, content limits, cautious risk semantics, and the text-only boundary. Reduce
now carries the complete nested final schema, enum/nullability/reference rules, quotation provenance,
and existing collection limits. Repair can add missing required fields or remove unknown fields,
receives sorted legal chunk IDs plus one of five safe non-content categories, and still receives no
raw transcript text.

TDD evidence: the focused suite first failed with five prompt/signature/category failures, then
passed all 27 tests after implementation. Final evidence: full worker suite `665 passed, 2 skipped`
with one existing `audioop` deprecation warning; full worker Ruff passed; governance WARN validation
reported 0 errors and 0 warnings; `git diff --check` exited 0. No live paid supplier call was made.

## Acceptance Criteria

- Map, reduce, and repair prompts each declare their complete applicable schema and JSON-only rule.
- Every parser-enforced nested key, enum, nullability rule, reference rule, and collection limit is
  represented in the prompt contract.
- Repair may add missing required fields and remove unknown fields, but cannot introduce new facts,
  quotations, or chunk IDs outside the supplied legal set.
- Reduce and repair prompts contain no raw transcript chunks; video, audio, URL, preferences, local
  paths, prior AI results, keys, and configuration remain excluded.
- Report schema, artifacts, UI, call-plan maximum, checkout semantics, cancellation, and error codes
  remain unchanged.

## Residual Risk

Prompt-contract tests prove instructions and runtime boundaries, not subjective supplier quality.
A live paid-supplier acceptance run remains release evidence and is not authorized by this plan.
