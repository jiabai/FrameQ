# Topic Planner Insights Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Improve topic point quality for ASR transcripts that arrive as one large unstructured text block. After this change, FrameQ first asks the configured InsightFlow LLM for a topic plan over the full transcript markdown, then generates questions per planned topic. If the planner output is unparseable or empty, the worker falls back to the previous direct chunk-based generation path, which still uses the 1000-character question-count heuristic from the prompt-tuning change.

## Progress

- [x] 2026-06-18: Designed the two-pass planner + question generation flow. Validation: design notes captured in this plan and the worker module.
- [x] 2026-06-18: Added the planner prompt that asks for strict JSON with `id`, `title`, `summary`, `excerpt`, and `question_count`. Validation: focused worker test asserts the prompt structure.
- [x] 2026-06-18: Implemented planner output parsing, normalization (at most 8 topics, 1-3 questions per topic, final list capped at 12). Validation: focused worker test asserts normalization behavior.
- [x] 2026-06-18: Implemented the second-pass question generation that reuses the existing reader-focused question prompt against each topic's title, summary, and excerpt. Validation: focused worker test asserts the two-pass payload.
- [x] 2026-06-18: Implemented the planner-failure fallback to the previous direct chunk-based path. Validation: focused worker test asserts the fallback is used on unparseable or empty planner output.
- [x] 2026-06-18: Ran worker tests, ruff, and the docs validation gate. Validation: `uv run pytest worker\tests`, `uv run ruff check worker`, and `python scripts/validate_agents_docs.py --level WARN`.

## Surprises & Discoveries

- Evidence: SenseVoice long-audio output arrives as a single transcript markdown rather than per-segment chunks, so the previous chunk-based question generation produced uneven topic distribution on long inputs.
- Evidence: asking the LLM for a topic plan first gives stable anchors (id, title, summary, excerpt) that the second pass can target, which is materially better than asking for free-form questions on a 4000-character transcript.
- Evidence: the planner LLM occasionally returns invalid JSON or a `topics: []` payload; the fallback path keeps the workflow alive without a manual retry.
- Evidence: the 1000-character question-count heuristic introduced by the prompt-tuning change is the right fallback for the chunk path; it stays unchanged so the fallback's quality does not regress when the planner is disabled.
- Evidence: capping the final insight list at 12 (and per-topic at 1-3) matches the reference service's downstream display, and avoids the planner producing 30+ topics that the UI would have to paginate.

## Decision Log

- Decision: Run a two-pass planner + question generation instead of asking the LLM for both in one call. Rationale: separate concerns and let the planner output be validated before the more expensive question generation runs; the planner also gives the UI stable anchors for any future topic-level surface. Date/Author: 2026-06-18 / Codex.
- Decision: Use strict JSON with `id`, `title`, `summary`, `excerpt`, and `question_count` in the planner prompt. Rationale: these five fields cover the question-prompt inputs (`title`, `summary`, `excerpt`) plus planner-side accounting (`id`, `question_count`) without leaking implementation details. Date/Author: 2026-06-18 / Codex.
- Decision: Normalize valid plans to at most 8 topics, 1-3 questions per topic, and a final list capped at 12. Rationale: matches the reference service's downstream display and keeps the UI from paging or scrolling within a single task. Date/Author: 2026-06-18 / Codex.
- Decision: Fall back to the previous direct chunk-based path on planner parse failure or empty `topics`. Rationale: a failed planner should not break the workflow; the fallback uses the prompt-tuning 1000-character heuristic so the result quality is still consistent. Date/Author: 2026-06-18 / Codex.
- Decision: Reuse the existing reader-focused question prompt (from the prompt-tuning change) for the second pass instead of introducing a new per-topic prompt. Rationale: keeps the question style consistent across the planner and fallback paths, and avoids two prompt surfaces to maintain. Date/Author: 2026-06-18 / Codex.

## Outcomes & Retrospective

Implemented. The worker now requests a topic plan from the InsightFlow LLM before generating questions, normalizes the plan, and runs a second-pass question prompt per topic. Unparseable or empty plans fall back to the direct chunk-based path, which still uses the 1000-character heuristic. No user-visible surface changed: the request/result schema, the UI states, and the history records are unchanged, and the final insight list is now stable at 12 across the planner path. Validation passed (`uv run pytest worker\tests`, `uv run ruff check worker`, `python scripts/validate_agents_docs.py --level WARN`). Residual risk: the planner is a single LLM call, so an outage of the configured LLM provider still triggers the fallback rather than a hard failure; this is intentional but should be visible in the worker logs as a "planner_failed" reason so support can spot it.

## Context and Orientation

- `worker/frameq_worker/insightflow/splitter.py` — owns the transcript-to-topic input and the final insight list normalization.
- `worker/frameq_worker/insightflow/generator.py` — runs the planner call, normalizes the result, then runs the per-topic question generation.
- `worker/frameq_worker/insightflow/prompt.py` — owns the planner prompt and the reader-focused question prompt; the question prompt is unchanged from the prompt-tuning change.
- `worker/frameq_worker/llm.py` — OpenAI-compatible LLM client; the planner and the per-topic question calls share the same client and default `temperature=0.7`.
- `worker/tests/test_insights.py` — regression coverage for planner parsing, two-pass flow, fallback path, and final cap.
- `docs/ARCHITECTURE.md` and `docs/DESIGN.md` — confirm the topic list is the user-visible InsightFlow output and that the cap is enforced before the UI receives the result.

## Plan of Work

1. Add the planner prompt and a focused test asserting the prompt structure.
2. Implement planner output parsing and normalization (at most 8 topics, 1-3 per topic, final list capped at 12) with a focused test.
3. Implement the second-pass question generation that reuses the existing reader-focused question prompt against each topic's `title`, `summary`, and `excerpt`, with a focused test.
4. Implement the fallback path that runs the previous direct chunk-based generation when the planner output is unparseable or empty, with a focused test.
5. Re-run the full worker suite, ruff, and the docs validation gate to confirm the change is clean.

## Validation and Acceptance

- `uv run pytest worker\tests` passes.
- `uv run ruff check worker` passes.
- `python scripts/validate_agents_docs.py --level WARN` passes.
- A long-audio transcript (one big markdown block) produces a topic list whose first topic's title matches the planner's first topic, and whose question count is `1-3` per topic.
- A planner failure (invalid JSON or empty `topics`) falls back to the direct chunk-based path, and the fallback result still uses the 1000-character question-count heuristic.
- The final insight list never exceeds 12 entries, regardless of planner behavior.
