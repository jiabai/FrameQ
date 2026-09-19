# Active Exec Plans


- `2026-09-16-douyin-share-page-retry-plan.md` - Implementation and automated gates complete for
  Douyin share page retry: up to three attempts with a randomized 3 to 10 second wait and a new
  `douyin.page.retrying` progress code across the Python registry, shared contract, TypeScript
  protocol, and three locales. Remaining follow-ups are the attempt-count judgment call and the
  absence of a share page diagnostic event.
- `2026-08-09-desktop-diagnostic-export-plan.md` - Implementation and automated gates complete for contract v8 structured ASR model-download diagnostics, Rust-owned bounded persistence, and user-initiated local ZIP export from failure UI and Settings > Advanced; Windows/macOS native release smoke remains pending, with no automatic upload or network probes.

See `../completed/index.md` for completed plans and `docs/exec-plans/index.md`
for the full index.
