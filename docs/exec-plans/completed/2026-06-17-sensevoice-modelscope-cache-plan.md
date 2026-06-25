# SenseVoice ModelScope Cache Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries,
Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Ensure SenseVoice Small and its FunASR VAD dependency cache under FrameQ's configured model directory instead of ModelScope's user-level default cache. After this change, `FRAMEQ_MODEL_DIR` (or the project `models/` fallback) is the single source of truth for both Qwen3-ASR (already routed) and SenseVoice. The user-visible change is that the model files for SenseVoice land next to the rest of the FrameQ-managed model cache, and uninstalling FrameQ or wiping the project leaves no orphaned model files in the user home directory.

## Progress

- [x] 2026-06-17: Added regression coverage that SenseVoice construction sets `MODELSCOPE_CACHE` to the resolved model cache directory. Validation: focused worker test asserts the env var.
- [x] 2026-06-17: Set `MODELSCOPE_CACHE` in the Python worker before constructing SenseVoice `AutoModel`. Validation: focused worker test asserts the value matches the resolved cache.
- [x] 2026-06-17: Stopped passing the ineffective `model_cache_dir` keyword to FunASR. Rationale: FunASR's `AutoModel` does not honor that keyword for ModelScope downloads, so passing it produced a misleading API surface. Validation: focused worker test asserts the constructor no longer receives `model_cache_dir`.
- [x] 2026-06-17: Documented that `FRAMEQ_MODEL_DIR` controls SenseVoice/ModelScope cache placement. Validation: spec/plan section updated, and worker tests cover the env override.
- [x] 2026-06-17: Ran worker tests, ruff, and the docs validation gate. Validation: `uv run pytest worker\tests` (55 passed), `uv run ruff check worker`, and `python scripts/validate_agents_docs.py --level WARN` (0 errors, 0 warnings).

## Surprises & Discoveries

- Evidence: FunASR's `AutoModel` constructor does not honor a `model_cache_dir` keyword for ModelScope downloads; the previous FrameQ call passed the keyword but the download still landed in `~/.cache/modelscope`.
- Evidence: ModelScope's `snapshot_download()` falls back to the `MODELSCOPE_CACHE` environment variable when no explicit `cache_dir` is passed, so the env var is the correct, minimal hook.
- Evidence: FrameQ already had a single resolved model directory helper that maps `FRAMEQ_MODEL_DIR` (override) or the project `models/` (default), and Qwen3-ASR was already routed through the same helper.
- Evidence: the `models/` directory is gitignored (`models/*` in `.gitignore`), so the cache can grow without leaking into version control.
- Evidence: the previous ineffective `model_cache_dir` keyword was being passed only to the SenseVoice constructor; the FunASR VAD model went through the same constructor, so fixing the env var also routes the VAD model cache correctly.

## Decision Log

- Decision: Set `MODELSCOPE_CACHE` in the Python worker before constructing SenseVoice `AutoModel`. Rationale: it is the documented ModelScope hook and works for both the SenseVoice model and the FSMN-VAD model that FunASR pulls as a dependency. Date/Author: 2026-06-17 / Codex.
- Decision: Remove the ineffective `model_cache_dir` keyword from the `AutoModel` call. Rationale: the keyword is not honored by FunASR for ModelScope, so passing it produced a misleading API surface and could have hidden future regressions. Date/Author: 2026-06-17 / Codex.
- Decision: Reuse the existing FrameQ model directory resolver (`FRAMEQ_MODEL_DIR` override, project `models/` default) as the source of truth for `MODELSCOPE_CACHE`. Rationale: keeps ASR cache, Qwen3-ASR cache, and SenseVoice/ModelScope cache under one location that the user can override through one env var. Date/Author: 2026-06-17 / Codex.
- Decision: Document the env var behavior in the spec and this plan rather than in inline code comments. Rationale: a reviewer or recovery session needs the override contract in one place, and the worker test already pins the behavior. Date/Author: 2026-06-17 / Codex.

## Outcomes & Retrospective

Implemented. SenseVoice Small and its FunASR VAD dependency now download into the same `models/` (or `FRAMEQ_MODEL_DIR`) location that Qwen3-ASR already uses. No user-visible surface changed: the request/result schema, progress events, and history records are unchanged, and the `FRAMEQ_MODEL_DIR` override still works for users who want a custom location. Validation passed (`uv run pytest worker\tests` 55 passed, `uv run ruff check worker`, `python scripts/validate_agents_docs.py --level WARN`). Residual risk: if ModelScope ever changes the env var name or the resolution order, the override will silently stop working; the regression test will fail at that point, but the failure message only confirms the env var is missing, not the underlying reason.

## Context and Orientation

- `worker/frameq_worker/asr.py` — SenseVoice adapter, the place that sets `MODELSCOPE_CACHE` and constructs FunASR `AutoModel`.
- `worker/frameq_worker/models.py` — FrameQ model directory resolver, the single source of truth for `FRAMEQ_MODEL_DIR` and the default `models/` path.
- `worker/tests/test_model_download.py` and `worker/tests/test_asr.py` — regression coverage for the env var and the constructor payload.
- `models/` — the default cache directory; gitignored by `models/*` in `.gitignore`.
- `MODELSCOPE_CACHE` — the upstream env var this plan routes through; not a FrameQ-introduced name.
- `docs/product-specs/2026-06-16-douyin-video-transcription-client.md` — durable spec that records the override contract.

## Plan of Work

1. Add a focused test asserting that constructing the SenseVoice model sets `MODELSCOPE_CACHE` to the resolved model directory.
2. Update the SenseVoice adapter to set `MODELSCOPE_CACHE` from the FrameQ model resolver before calling `AutoModel(...)`.
3. Drop the ineffective `model_cache_dir` keyword from the `AutoModel` call.
4. Document `FRAMEQ_MODEL_DIR` as the override for SenseVoice/ModelScope cache placement in the spec and this plan.
5. Re-run the focused tests, the full worker suite, ruff, and the docs validation gate to confirm the change is clean.

## Validation and Acceptance

- `uv run pytest worker\tests` passes (55 tests at the time of the change).
- `uv run ruff check worker` passes.
- `python scripts/validate_agents_docs.py --level WARN` passes (0 errors, 0 warnings).
- Constructing the SenseVoice model with a custom `FRAMEQ_MODEL_DIR` writes the SenseVoice model and the FSMN-VAD dependency into that directory, not into `~/.cache/modelscope`.
- Constructing the SenseVoice model without `FRAMEQ_MODEL_DIR` writes the cache into the project `models/` directory.
- The SenseVoice adapter no longer passes `model_cache_dir` to `AutoModel`.
