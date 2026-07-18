# YouTube generic Chinese subtitle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** Make FrameQ reuse an exact generic Chinese `zh` platform subtitle before local ASR.

**Architecture:** Keep the current subtitle-first pipeline and closed language policy. Add exact
`zh` to the yt-dlp request and parser priority without enabling translated-caption regexes, changing
download/authentication behavior, or weakening ASR fallback.

**Tech Stack:** Python worker, yt-dlp, pytest, Ruff, Markdown governance validation.

---

## Purpose / Big Picture

For a public YouTube or Bilibili video whose platform caption uses the generic `zh` language code,
FrameQ downloads and parses that VTT/SRT as the official transcript. Explicit script variants remain
higher priority. Missing, malformed, or unsupported subtitles still fall back to local SenseVoice.

## Progress

- [x] 2026-07-18: Reproduced the mismatch without downloading media: the video exposes original
  `zh`, production languages select zero tracks, exact `zh` selects `zh / vtt`, and `zh.*` also
  selects two translated variants. Validation: read-only `yt-dlp --list-subs` and `--simulate`.
- [x] 2026-07-18: Approved the exact-`zh` design and documented product/design intent before code.
  Validation: user explicitly authorized implementation after reviewing the proposed repair.
- [x] 2026-07-18: Added focused failing tests for the exact request string and generic-Chinese-over-
  English parser priority. Validation: focused pytest produced the expected 3 failures and 32 passes;
  both request assertions lacked `zh`, and the parser returned `en` instead of `zh`.
- [x] 2026-07-18: Applied the minimal two-constant implementation without pipeline or fallback
  changes. Validation: the same focused suite passed 35/35.
- [x] 2026-07-18: Ran full worker/governance/diff gates and no-download live metadata acceptance.
  Validation: worker passed 364/364, Ruff passed, governance reported 0 errors/0 warnings,
  `git diff --check` passed, and the confirmed URL selected `zh / vtt`.
- [x] 2026-07-18: Committed the reviewed implementation, fast-forwarded local `main`, reran the
  complete acceptance gates on the merged tree, and removed the feature worktree/branch. Validation:
  commit `5d70d1e`; merged worker 364/364, Ruff, governance 0/0, diff check, and `zh / vtt` live
  simulation all passed.

## Surprises & Discoveries

- Evidence: `yt-dlp --list-subs` currently reports original `zh` VTT/SRT for video
  `dGzm8O95tdc`, while `worker/frameq_worker/media.py` omits generic `zh`.
- Evidence: production `--sub-langs` selects zero requested tracks for that video; exact `zh`
  selects `zh / vtt`; `zh.*` selects `zh`, `zh-Hans-zh`, and `zh-Hant-zh`.
- Evidence: `worker/frameq_worker/subtitles.py` ranks only the same six currently requested
  languages, so request and parser policy must change together.

## Decision Log

- Decision: Add exact `zh` after `zh-Hant` and before `en` in both closed lists. Rationale:
  script-specific Chinese is more deterministic, but generic Chinese remains preferable to a
  non-Chinese transcript or local ASR. Date/Author: 2026-07-18, User + Codex.
- Decision: Do not request `zh.*`, `all`, or translated suffixes. Rationale: they download duplicate
  automatic translations and can obscure the original platform track. Date/Author: 2026-07-18,
  User + Codex.
- Decision: Keep duplicate constants for this narrow fix. Rationale: introducing a new shared-policy
  module is unrelated refactoring; focused equality expectations catch the two-site contract.
  Date/Author: 2026-07-18, Codex.
- Decision: Do not add a live-network automated test. Rationale: upstream captions can change;
  deterministic fixtures guard behavior and the confirmed URL remains a manual no-download
  acceptance check. Date/Author: 2026-07-18, Codex.

## Outcomes & Retrospective

Implementation, local verification, and local integration are complete. FrameQ now requests exact generic `zh`, ranks it
after script-specific Chinese and before English, and retains the existing malformed/missing subtitle
ASR fallback. The deterministic focused suite passed 35/35 and the full worker suite passed 364/364;
the confirmed live URL selected `zh / vtt` without downloading media.

Residual risk: YouTube may change or remove the external video's caption metadata, so the live URL is
evidence rather than a stable CI fixture. FrameQ intentionally does not distinguish manual versus
automatic captions in UI and continues to report only `Platform subtitle`.

## Context and Orientation

- Product source of truth: `docs/product-specs/2026-06-16-douyin-video-transcription-client.md`.
- Design decision: `docs/design-docs/2026-07-18-youtube-generic-chinese-subtitle.md`.
- Download policy: `worker/frameq_worker/media.py` and `worker/tests/test_media.py`.
- Parser priority: `worker/frameq_worker/subtitles.py` and `worker/tests/test_subtitles.py`.
- ASR fallback orchestration: `worker/frameq_worker/pipeline.py`.
- Concurrent unrelated user changes in the primary worktree: `docs/ARCHITECTURE.md` and
  `docs/design-docs/frameq-code-audit-uml.md` must remain untouched.

## Plan of Work

### Task 1: Establish RED language-request behavior

**Files:**

- Modify: `worker/tests/test_media.py`
- Test: `worker/tests/test_media.py`

- [x] Change both YouTube and Bilibili expectations to require:

  ```python
  "zh-Hans,zh-CN,zh-Hant,zh,en,ja,ko"
  ```

- [x] Run `uv run pytest worker/tests/test_media.py -q` and confirm failure shows the current value
  is missing exact `zh`.

### Task 2: Establish RED parser-priority behavior

**Files:**

- Modify: `worker/tests/test_subtitles.py`
- Test: `worker/tests/test_subtitles.py`

- [x] Add a test with `demo.en.vtt` and `demo.zh.vtt` requiring `language == "zh"` and the Chinese
  text.
- [x] Extend the existing preference test with `demo.zh.vtt` and continue requiring `zh-Hans`,
  proving script-specific Chinese outranks generic Chinese.
- [x] Run `uv run pytest worker/tests/test_subtitles.py -q`; the generic-Chinese-over-English test
  must fail by selecting `en` before the production constant changes.

### Task 3: Implement exact generic Chinese support

**Files:**

- Modify: `worker/frameq_worker/media.py`
- Modify: `worker/frameq_worker/subtitles.py`

- [x] Change `PLATFORM_SUBTITLE_ARGS` to request:

  ```python
  "zh-Hans,zh-CN,zh-Hant,zh,en,ja,ko"
  ```

- [x] Change `PREFERRED_SUBTITLE_LANGUAGES` to:

  ```python
  ("zh-Hans", "zh-CN", "zh-Hant", "zh", "en", "ja", "ko")
  ```

- [x] Run focused tests and Ruff; make no pipeline, login, cookie, retry, subtitle parser, or ASR
  changes.

### Task 4: Verify and close out

**Files:**

- Modify: `docs/exec-plans/active/2026-07-18-youtube-generic-chinese-subtitle-plan.md`
- Modify: `TASKS.md`

- [x] Run all validation commands below and record exact results.
- [x] Run the confirmed URL with no cache, simulation, and no media download; report only selected
  language and format, never caption URLs.
- [x] Update Progress and Outcomes, archive after the user-approved local merge, and do not push,
  tag, or publish.

## Validation and Acceptance

- `uv run pytest worker/tests/test_media.py worker/tests/test_subtitles.py -q`
- `uv run pytest worker/tests`
- `uv run ruff check worker`
- `python scripts/validate_agents_docs.py --level WARN`
- `git diff --check`
- `yt-dlp --no-cache-dir --simulate --write-subs --write-auto-subs --sub-langs "zh-Hans,zh-CN,zh-Hant,zh,en,ja,ko" --sub-format best --dump-single-json "https://www.youtube.com/watch?v=dGzm8O95tdc"` with output reduced to requested language and extension.

Acceptance requires focused RED then GREEN evidence, full worker tests, Ruff, governance, clean
diff whitespace, and live no-download selection of `zh / vtt`. Existing user-owned dirty files must
remain byte-for-byte outside this diff.
