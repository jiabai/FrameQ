# Transcript Dissection Actionable Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing dissection fields provide concrete, slot-based writing-transfer guidance
with required/optional nodes and clear applicability limits.

**Architecture:** Change only map/reduce/repair prompt semantics and focused contract tests. Keep
report schema version 1, call-plan version 1, artifacts, UI, quota, privacy, and text-only analysis
boundaries unchanged.

**Tech Stack:** Python 3, pytest, Ruff.

---

## Progress

- [x] 2026-08-01: Confirmed current prompts mention transferability but do not require slots,
  required/removable nodes, applicable types, or inapplicability conditions.
- [x] 2026-08-01: User approved semantic hardening within existing fields and boundaries.
- [x] Task 1: Added RED actionable-reuse prompt tests.
- [x] Task 2: Implemented map/reduce/repair content rules.
- [x] Task 3: Verified, recorded evidence, and archived.

## Decisions

- Use `reusablePattern` and `reusableTemplate`; add no new schema field.
- Keep segment limitations in `riskFlags` and global inapplicability in `weaknesses`.
- Require bracketed replaceable slots plus required/optional node markers in the frozen output
  language, without prescribing one literal translated marker vocabulary.
- Never infer visual, audio, editing, equipment, or conversion-performance advice from text.

## Task 1: RED Tests

- [x] Extend map-prompt assertions for replaceable slots, structural must-keep nodes,
  optional/removable nodes, applicable content types, inapplicability, and writing-only transfer.
- [x] Extend reduce assertions so consolidation preserves those semantics and routes global limits
  to `weaknesses` without inventing products, audiences, or outcomes.
- [x] Extend repair assertions so repairs preserve actionable-reuse semantics without manufacturing
  missing evidence.
- [x] Run focused pytest and record three expected failures against current prompts.

## Task 2: Prompt Implementation

- [x] Add precise actionable-reuse rules and bracketed-slot examples to map.
- [x] Require reduce to consolidate must-keep/replaceable/optional/applicability information into
  existing segment/template/risk/weakness fields.
- [x] Require repair to preserve this information and fail closed rather than invent evidence.
- [x] Retain JSON-only, schema, provenance, output-language, privacy, and text-only constraints.
- [x] Run focused pytest and Ruff until green (`31 passed`; Ruff passed).

## Task 3: Verification and Closure

- [x] Run `uv run pytest worker/tests/test_dissection.py -q` (`31 passed`).
- [x] Run the full worker suite with a repository-local `--basetemp` (`669 passed, 2 skipped`).
- [x] Run `uv run ruff check worker` (`All checks passed`).
- [x] Run governance WARN validation and `git diff --check` (0 issues; exit 0).
- [x] Inspect the scoped diff, record evidence, and archive this plan.

## Outcomes

Map now collects required structural functions, replaceable bracketed slots, optional/removable
nodes, applicable content types, and segment/global inapplicability evidence. Reduce consolidates
that evidence into existing `reusablePattern`, `reusableTemplate.skeleton`, `riskFlags`, and
`weaknesses` fields without adding schema fields. Repair preserves present transfer evidence while
explicitly refusing to manufacture missing products, audiences, outcomes, use cases, or structural
claims.

All three stages now state that reuse means writing/content-structure transfer only and prohibit
claims about shots, camera movement, voice, music, captions, equipment, editing, or conversion
performance. TDD first produced three expected prompt-contract failures. Final evidence: focused
`31 passed`; full worker `669 passed, 2 skipped` with one existing `audioop` deprecation warning;
full Ruff passed; governance reported 0 errors and 0 warnings; `git diff --check` exited 0.

## Acceptance Criteria

- Prompts require replaceable slots, required nodes, optional/removable nodes, applicable content
  types, and inapplicability/transfer risks using existing fields.
- Advice is explicitly limited to writing and content-structure transfer.
- Prompts prohibit invented products, audiences, outcomes, and visual/audio/editing/conversion
  claims.
- Schema, artifacts, UI, generation calls, quota, privacy, cancellation, and persistence do not
  change.
