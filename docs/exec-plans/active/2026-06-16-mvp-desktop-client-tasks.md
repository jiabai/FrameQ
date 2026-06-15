# MVP Desktop Client Tasks

## 进行中

- [x] Confirm this ExecPlan with the user before implementation（2026-06-16）✅ User explicitly confirmed implementation should begin and requested `uv`
- [ ] Implement ASR adapter and transcript writers ✅ Transcript `.txt` and `.md` are non-empty in `outputs/`

## 待办

- [ ] Install Rust/Cargo to unblock Tauri desktop build ✅ `cargo -V` succeeds and `npm --prefix app run tauri -- build` no longer fails with `program not found`
- [ ] Embed and adapt InsightFlow topic generation ✅ Insights `.json` contains non-empty `insights` or structured partial-complete error
- [ ] Wire Tauri command to worker and UI progress ✅ Desktop flow reaches result or structured failure state
- [ ] Add copy/export interactions ✅ Exported files match generated outputs

## 已完成

- [x] Implement download and media validation service（2026-06-16）✅ Sample URL creates MP4 and valid ffprobe JSON
- [x] Implement audio extraction service（2026-06-16）✅ Sample MP4 creates 16 kHz mono WAV
- [x] Bootstrap `app/` Tauri React TypeScript scaffold（2026-06-16）✅ `npm --prefix app run build` passes
- [x] Add UI state model for input, processing, complete, partial complete, and failed states（2026-06-16）✅ `npm --prefix app test` passes
- [x] Bootstrap `worker/` Python package and request/result schema（2026-06-16）✅ `uv run pytest worker\\tests` passes
- [x] Create project governance, product spec, and initial ExecPlan（2026-06-16）✅ `python scripts/validate_agents_docs.py --level ERROR` passes
