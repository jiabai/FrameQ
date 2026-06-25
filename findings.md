# Findings & Decisions

## Requirements
- User asked to inspect project docs, find unimplemented features, and implement them sequentially.
- Must avoid touching unrelated untracked files.
- Must follow FrameQ governance docs for non-trivial changes.

## Research Findings
- `TASKS.md` has one in-progress feature: desktop one-click updates via Tauri updater plus GitHub-hosted dynamic metadata.
- `TASKS.md` has one todo that is mostly external validation: clean Windows VM and macOS arm64/x64 real installer verification.
- `docs/exec-plans/active/index.md` also lists a 2026-06-25 Douyin share page fallback plan. It may be an unimplemented or partially implemented feature and needs code verification.
- `docs/ARCHITECTURE.md` defines update behavior: Tauri updater signed artifacts, GitHub Releases `latest.json`, app-local `updates.json`, and preserving models/outputs/work/auth/.env across app updates.
- `docs/exec-plans/active/2026-06-23-desktop-one-click-updates-plan.md` marks product spec, config, UI, automation, and automated verification complete; remaining work is external signed-release validation on clean Windows/macOS machines.
- `docs/exec-plans/active/2026-06-25-douyin-share-page-fallback-plan.md` has unchecked worker/parser/probing/strategy tasks and is the first locally implementable missing feature.
- Douyin fallback requirements: `yt-dlp` first, then Douyin-only share-page fallback for matching failures; parse `window._ROUTER_DATA`, build/probe candidates, choose largest valid stream, keep anonymous cookies in memory only, no browser cookies/CAPTCHA/login bypass.
- Code verification: `worker/frameq_worker/media.py` has `download_video` that only invokes `yt-dlp` and raises `CommandExecutionError`; `worker/frameq_worker/douyin_fallback.py` does not exist yet.
- Implementation added `worker/frameq_worker/douyin_fallback.py`, integrated Douyin-only fallback in `media.download_video`, passed `progress_callback` through the pipeline, and added frontend copy for fallback exhaustion.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Start from docs and task lists before code edits. | The request is documentation-driven, and FrameQ requires spec/plan alignment for user-visible behavior. |
| Use stdlib urllib/cookiejar for Douyin fallback HTTP. | Meets the plan's "stdlib HTTP/JSON" direction and keeps anonymous cookies process-local. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
- `AGENTS.md`
- `WORKFLOW.md`
- `TASKS.md`
- `docs/exec-plans/active/index.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/SECURITY.md`
- `docs/exec-plans/active/2026-06-25-douyin-share-page-fallback-plan.md`
- `docs/exec-plans/active/2026-06-23-desktop-one-click-updates-plan.md`
- `worker/frameq_worker/media.py`
- `worker/tests/test_media.py`

## Visual/Browser Findings
- None.
