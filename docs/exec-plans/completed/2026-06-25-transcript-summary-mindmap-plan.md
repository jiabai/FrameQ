# Transcript Summary and Mermaid Mindmap ExecPlan

## Goal

Add a confirmed AI整理 flow that generates a Markdown summary, local Mermaid mindmap file, and the existing insight topics from a completed transcript.

## Decisions

- Keep the existing `retry_insights` Tauri command and server-managed LLM checkout.
- Superseded quota note: current specs count one use per cloud LLM API call attempt, so one confirmation may consume multiple uses.
- Write `<stem>_summary.md` and `<stem>_mindmap.mmd` to the configured output directory.
- UI displays summary content but never displays or renders Mermaid source.
- Preserve whichever AI artifact succeeds if summary or insight generation partially fails.

## Progress

- [x] Worker summary/mindmap generator and result contract implemented.
- [x] Combined AI整理 retry/pipeline and history path persistence implemented.
- [x] React result card/detail/history behavior implemented.
- [x] Tauri result fallback and history bridge updated.
- [x] Full validation gates completed.

## Validation

- `uv run pytest worker\tests` - passed, 90 tests.
- `uv run ruff check worker` - passed.
- `npm --prefix app test` - passed, 84 tests.
- `npm --prefix app run build` - passed.
- `cargo test --manifest-path app\src-tauri\Cargo.toml` - passed, 31 tests.
- `python scripts\validate_agents_docs.py --level WARN` - passed.

## Outcomes & Retrospective

Delivered the confirmed AI整理 flow that writes transcript summaries and Mermaid mindmap files alongside existing insight topics, persists the new artifact paths through history, and exposes summary/mindmap outputs in the result workspace. Validation recorded above covered worker, frontend, Tauri, build, lint, and governance gates.

Residual risk: Mermaid source is saved as a local artifact but not rendered in the UI, and partial artifact success remains possible when one LLM-generated artifact fails while others succeed.
