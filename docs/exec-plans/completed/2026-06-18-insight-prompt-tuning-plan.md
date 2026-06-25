# Insight Prompt Tuning Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Align FrameQ's embedded InsightFlow topic generation behavior with the local reference service where it affects output quality, without reintroducing a runtime dependency on `D:\Github\InsightFlow\src\server`. The change covers three concrete gaps that showed up when comparing prompts and parameters side by side: FrameQ lacked the reference service's reader-facing expression constraints, FrameQ used a more aggressive 500-character question-count formula, and FrameQ forced `temperature=0.2` while the reference service runs at `0.7`. A later topic-planner change keeps the 1000-character heuristic as the direct-generation fallback, so this plan's tuning is preserved even after the planner lands.

## Progress

- [x] 2026-06-18: Audited FrameQ's InsightFlow prompt against the reference service. Validation: side-by-side prompt comparison captured in this plan's Findings.
- [x] 2026-06-18: Updated `worker/frameq_worker/insightflow/prompt.py` with the reference service's reader-focused expression constraints and the optional `global_prompt` / `question_prompt` sections. Validation: focused worker test asserts the prompt content.
- [x] 2026-06-18: Updated `worker/frameq_worker/insightflow/generator.py` to calculate topic count as approximately one question per 1000 characters, with at least one question per chunk. Validation: focused worker test asserts the topic count formula and the per-chunk minimum.
- [x] 2026-06-18: Changed `worker/frameq_worker/llm.py` default OpenAI-compatible `temperature` to `0.7`. Validation: focused worker test asserts the LLM request payload carries `temperature=0.7`.
- [x] 2026-06-18: Ran worker tests, ruff, and the docs validation gate. Validation: `uv run pytest worker\tests`, `uv run ruff check worker`, and `python scripts/validate_agents_docs.py --level WARN`.

## Surprises & Discoveries

- Evidence: FrameQ's previous prompt already used the same core role and JSON-output shape as the reference service, so the change was a content-level alignment, not a structural rewrite.
- Evidence: the reference service's reader-facing expression constraints (angle-of-thinking, one-line readability) materially improve question quality and were missing in FrameQ.
- Evidence: FrameQ's previous 500-character formula generated 2-3x too many questions on long transcripts, which made the result list noisy and the copy/export surface long.
- Evidence: `temperature=0.7` is the reference service's default; the previous `0.2` produced overly deterministic but repetitive questions on long inputs.
- Evidence: the prompt-tuning change keeps the 1000-character formula even after the later topic-planner change, so the planner's fallback path benefits from the same heuristic.
- Evidence: `FRAMEQ_LLM_TEMPERATURE` (if set) overrides the new `0.7` default at the LLM client level, so the change is non-breaking for users who already pin a value.

## Decision Log

- Decision: Align FrameQ's prompt with the reference service's reader-focused expression constraints rather than authoring a new FrameQ-only style. Rationale: the reference service's wording is battle-tested on real Chinese transcripts, and FrameQ already commits to "copy and embed" only the needed InsightFlow logic. Date/Author: 2026-06-18 / Codex.
- Decision: Use the 1000-character question-count heuristic (one question per ~1000 characters, at least one per chunk) instead of the previous 500-character formula. Rationale: matches the reference service's output density and avoids the 2-3x inflation on long transcripts. Date/Author: 2026-06-18 / Codex.
- Decision: Change the default `temperature` to `0.7` but keep the env-var override. Rationale: matches the reference service's default and gives the LLM room to vary phrasing; users who pinned a value already keep their setting. Date/Author: 2026-06-18 / Codex.
- Decision: Add the optional `global_prompt` and `question_prompt` sections even though the default call site does not use them. Rationale: a future caller can attach domain-specific guidance without re-auditing the prompt surface. Date/Author: 2026-06-18 / Codex.
- Decision: Do not introduce a runtime import of `D:\Github\InsightFlow\src\server`. Rationale: the desktop app must be independently packaged, and copying the needed prompt content is the project rule. Date/Author: 2026-06-18 / Codex, from the AGENTS.md core belief "运行期不得从 `D:\Github\InsightFlow\src\server` 跨目录 import".

## Outcomes & Retrospective

Implemented. The InsightFlow prompt now matches the reference service's reader-focused style, the topic-count formula uses 1000 characters, and the default `temperature` is `0.7`. The 1000-character heuristic was preserved by the later topic-planner change as the direct-generation fallback strategy. No user-visible surface changed: the request/result schema, UI states, and history records are unchanged. Validation passed (`uv run pytest worker\tests`, `uv run ruff check worker`, `python scripts/validate_agents_docs.py --level WARN`). Residual risk: the prompt is still Chinese-language tuned; English transcripts may read slightly stilted, but the `.env` `FRAMEQ_LLM_*` configuration and the optional `global_prompt` section give downstream callers a way to add English guidance without re-tuning the default.

## Context and Orientation

- `worker/frameq_worker/insightflow/prompt.py` — owns the prompt content, including the reader-focused expression constraints and the optional `global_prompt` / `question_prompt` sections.
- `worker/frameq_worker/insightflow/generator.py` — owns the topic-count formula (1000-character heuristic, at least one per chunk).
- `worker/frameq_worker/llm.py` — OpenAI-compatible LLM client; default `temperature=0.7`, env-var override `FRAMEQ_LLM_TEMPERATURE` still wins.
- `worker/tests/test_insights.py` — regression coverage for prompt content, optional prompt sections, topic-count calculation through generated prompts, and the LLM request payload temperature.
- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md` — durable spec that records the InsightFlow behavior.
- `2026-06-18-topic-planner-insights-plan.md` — the later change that uses the 1000-character heuristic as the fallback.

## Plan of Work

1. Audit FrameQ's prompt against the reference service's prompt and capture the gaps in this plan.
2. Update `worker/frameq_worker/insightflow/prompt.py` with the reader-focused expression constraints and the optional sections.
3. Update `worker/frameq_worker/insightflow/generator.py` to use the 1000-character topic-count heuristic with a per-chunk minimum.
4. Update `worker/frameq_worker/llm.py` to default `temperature` to `0.7` while keeping the env-var override.
5. Add focused worker tests for prompt content, optional sections, topic-count calculation, and the LLM payload temperature.
6. Re-run the full worker suite, ruff, and the docs validation gate to confirm the change is clean.

## Validation and Acceptance

- `uv run pytest worker\tests` passes.
- `uv run ruff check worker` passes.
- `python scripts/validate_agents_docs.py --level WARN` passes.
- The InsightFlow prompt contains the reference service's reader-focused expression constraints and the optional `global_prompt` / `question_prompt` sections.
- The topic-count formula produces approximately one question per 1000 characters and at least one question per chunk.
- The default LLM request payload carries `temperature=0.7`; an explicit `FRAMEQ_LLM_TEMPERATURE` override still wins.
- The change does not import anything from `D:\Github\InsightFlow\src\server`.
