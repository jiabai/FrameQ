# Completed Exec Plans

| File | Focus |
|------|-------|
| `2026-07-23-rust-worker-runner-module-split-plan.md` | Reduced the 2,162-line Rust worker runner to a 415-line sole lifecycle orchestrator with private process-I/O, watchdog, progress, terminal, and focused-test owners without changing behavior or callers. |
| `2026-07-23-frontend-transcript-controller-split-plan.md` | Reduced the 509-line mixed frontend transcript hook to a stable 126-line facade with private artifact, document, and review owners while preserving its 41-key surface and task isolation. |
| `2026-07-22-server-auth-quota-concurrency-hardening-plan.md` | Made purpose-scoped OTP, ticket/session exchange, dispatch limiting, and AI Credit checkout atomic and retry-safe with reviewed migrations and independent Prisma/SQLite concurrency evidence. |
| `2026-07-22-worker-watchdog-plan.md` | Added Rust-owned idle/absolute worker deadlines, instance-safe process-tree termination, closed timeout outcomes, localized recovery guidance, and native Windows watchdog evidence. |
| `2026-07-22-atomic-persistence-hardening-plan.md` | Made transcript, AI, manifest, preference-snapshot, and Rust transcript-edit persistence atomic per file and recoverable as complete task-level revisions. |
| `2026-07-21-worker-pipeline-module-split-plan.md` | Reduced `pipeline.py` to a 39-line stable import surface and split shared policy, transcript/ASR, AI generation, and URL orchestration into private dependency-gated owners without changing behavior. |
| `2026-07-21-task-manifest-module-split-plan.md` | Reduced `task_manifest.rs` to a 26-line stable surface and split canonical source policy, pure schema, filesystem trust, validated access, and tests into a private non-bypassable module tree. |
| `2026-07-21-server-route-module-split-plan.md` | Reduced `server.ts` to a stable 112-line composition root and split all 20 routes into private capability registrars without changing HTTP, security, or transaction behavior. |
| `2026-07-20-asr-module-split-plan.md` | Keep `frameq_worker.asr` stable while splitting types, registry/cache, Qwen, SenseVoice/VAD, and transcript artifact ownership into a private package. |
| `2026-07-20-transcript-detail-module-split-plan.md` | Split the Rust transcript-detail hotspot into a 134-line stable Tauri root plus private audio playback, segment codec, and edit-storage failure boundaries without changing commands or behavior. |
| `2026-07-20-douyin-fallback-module-split-plan.md` | Split the Douyin public-video fallback into a 132-line stable adapter and private type, source, Router Data, stream/probe, and transport failure boundaries without changing platform behavior. |
| `2026-07-20-xiaohongshu-fallback-module-split-plan.md` | Split the Xiaohongshu public-video fallback into a 169-line stable adapter and private type, source, page-state, stream-policy, and transport failure boundaries without changing platform behavior. |
| `2026-07-20-bilibili-fallback-module-split-plan.md` | Split the Bilibili public-video fallback into a 137-line stable adapter and private type, source, playback, transport, and artifact failure boundaries without changing platform behavior. |
| `2026-07-20-video-processing-module-split-plan.md` | Split the Rust video-processing hotspot into a 68-line Tauri root plus focused retry, URL cache, URL orchestration, and existing closed task-result modules without changing behavior or contract v3. |
| `2026-07-19-video-processing-task-result-boundary-plan.md` | Extracted fixed task terminal-result adaptation from `video_processing.rs` behind a closed private process/retry context without changing commands, contracts, or runtime behavior. |
| `2026-07-19-app-composition-integration-coverage-plan.md` | Proved startup authentication deep-link and task artifact-location wiring through the real Chromium-rendered App lifecycle. |
| `2026-07-19-closed-worker-terminal-results-plan.md` | Closed operation-specific worker terminal results at the Python producer, Rust stdout, and TypeScript IPC boundaries without echoing rejected content. |
| `2026-07-19-typed-worker-job-facade-plan.md` | Derived video-worker invocation, operation, progress, retry-only LLM policy, and lane from one typed Rust job facade while preserving the shared lifecycle runner. |
| `2026-07-18-process-video-request-contract-v3-plan.md` | Replaced the false five-field process request with URL-only IPC intent, a Rust-resolved strict v3 worker request, and fail-closed Python parsing. |
| `2026-07-18-rust-worker-runtime-lifecycle-refactor-plan.md` | Unified every Rust-owned worker/model-download child under one private supervised runner with typed terminal outcomes, closed progress routes, safe diagnostics, and native Windows/macOS cancellation evidence. |
| `2026-07-18-source-identity-dependency-inversion-plan.md` | Separated pure SourceIdentity policy from platform short-link infrastructure and injected a closed resolver registry at the worker CLI composition root. |
| `2026-07-18-youtube-generic-chinese-subtitle-plan.md` | Added exact generic Chinese `zh` platform-subtitle request and priority before local ASR, without enabling translated-caption regexes. |
| `2026-07-15-desktop-i18n-ai-output-language-plan.md` | Added offline three-language desktop localization, app-local language recovery, structured progress/error copy, and strict confirmation-time AI output language across TypeScript, Rust, and Python. |
| `2026-07-12-github-actions-node24-upgrade-plan.md` | Upgraded checkout, setup-node, setup-uv, and artifact upload to Node.js 24 runtimes with TDD and clean hosted macOS annotations, without triggering Desktop Release. |
| `2026-07-12-v0.2.16-open-source-release-plan.md` | Published v0.2.16 as a three-platform stable GitHub Release after version-drift TDD, full local gates, Draft artifact/runtime/codesign validation, checksum inspection, and explicit Gatekeeper disclosure. |
| `2026-07-12-macos-intel-acceptance-artifact-plan.md` | Verified permanent deletion and ProcessSupervisor fixtures on hosted Intel macOS and produced a checksum-verified internal x86_64 DMG Actions Artifact without creating a release. |
| `2026-07-12-history-task-permanent-deletion-plan.md` | Added strict, accessible permanent deletion for supported History vNext tasks and playback cache with truthful partial-failure semantics and Windows/macOS filesystem evidence. |
| `2026-07-12-desktop-density-history-toolbar-polish-plan.md` | Made History intrinsically sized, clarified secondary typography and active-task rhythm, and grouped compact desktop toolbar utilities. |
| `2026-07-12-task-workspace-visual-hierarchy-plan.md` | Reduced nested card weight, clarified status ownership, removed duplicate eyebrow labels, quieted pre-confirmation AI actions, and separated transcript playback/edit/focus states. |
| `2026-07-11-ai-credits-terminology-plan.md` | Replaced misleading generation-count wording with transparent AI Credits balance and variable-cost disclosure without changing quota accounting. |
| `2026-07-11-local-transcript-ai-workspaces-plan.md` | Split one task into independent local transcript and confirmed AI-generation workspaces, and made `retry_insights` the sole AI command. |
| `2026-07-11-history-vnext-strict-boundary-plan.md` | Replaced legacy-compatible history with schema-v3 manifest-only list/detail loading and complete product isolation of unsupported task data. |
| `2026-06-18-installer-distribution-runtime-plan.md` | Completed lightweight Windows/macOS installer runtime packaging, first-run SenseVoice download, bundled Deno, and user-confirmed clean-machine validation. |
| `2026-07-11-react-ui-smoke-coverage-plan.md` | Added deterministic real-React/CDP smoke for settings, history task ownership, transcript-save isolation, and target-scoped AI confirmation using mocked Tauri IPC only. |
| `2026-07-11-unix-process-supervisor-ci-validation-plan.md` | Verified the real macOS ProcessSupervisor parent-child process-group cancellation fixture in a complete 90-test hosted Cargo run; Linux is not a supported target. |
| `2026-07-10-worker-stdin-request-transport-plan.md` | Removed raw source URLs and serialized requests from worker argv/environment by using bounded supervised stdin delivery. |
| `2026-07-08-split-summary-insights-generation-plan.md` | Split summary/mindmap and inspiration generation into independent target-scoped actions with artifact-preserving manifest updates. |
| `2026-07-10-history-task-restore-ownership-plan.md` | Moved history restore into the workflow controller, blocked active task switches, and isolated stale callbacks from restored task identity. |
| `2026-07-10-desktop-process-supervision-cancellation-plan.md` | Unified video-worker and ASR-download cancellation supervision, process-tree/group termination, and truthful desktop cancellation state. |
| `2026-07-10-admin-quota-audit-migration-plan.md` | Retired unaudited administrator remaining-quota edits in favor of the atomic audited additive-compensation boundary and documented WeChat Pay as disabled/unintegrated. |
| `2026-07-10-server-entitlement-transaction-safety-plan.md` | Made server payment settlement, activation redemption, and administrator entitlement compensation atomic and safely retryable. |
| `2026-07-10-source-url-privacy-boundary-plan.md` | Added transient download URL separation, canonical persisted source identity, pure-text AI input, safe cache/history matching, and bounded legacy artifact cleanup/quarantine. |
| `2026-07-07-tauri-lib-module-split-plan.md` | Split the oversized Tauri `lib.rs` into focused runtime, diagnostics, worker command, ASR model, video processing, and deep-link modules without behavior changes. |
| `2026-07-07-personalized-insight-preferences-plan.md` | Add local inspiration profile, six-step per-run generation preferences, confirmation snapshot, and structured personalized insight-topic results without server-side preference storage. |
| `2026-07-07-per-llm-call-quota-plan.md` | Aligned server-managed LLM quota accounting with the per-cloud-LLM-API-call quota definition. |
| `2026-07-05-subtitle-first-asr-fallback-plan.md` | Reused public YouTube/Bilibili `yt-dlp` subtitle files as transcript source before local ASR, with ASR fallback and source metadata. |
| `2026-07-05-task-owned-artifact-layout-plan.md` | Replaced flat output/history paths with task-owned artifact directories and manifest-driven desktop history. |
| `2026-07-03-transcript-audio-review-editor-plan.md` | Added transcript audio review/editing with optional ASR time segments, safe local Tauri IO, audio playback, block highlight, and save semantics. |
| `2026-07-05-macos-youtube-runtime-diagnostics-plan.md` | Added explicit YouTube JavaScript runtime selection and sanitized app-local desktop diagnostics for macOS runtime debugging. |
| `2026-06-29-youtube-public-video-support-plan.md` | Added public YouTube watch/short/Shorts support through existing yt-dlp pipeline with 720p transcription-first policy, sanitized `YOUTUBE_*` failures, and no login/cookie/playlist behavior. |
| `2026-06-27-bilibili-public-video-fallback-plan.md` | Completed Bilibili ordinary public-video fallback with BV/av/b23.tv input acceptance, public API metadata/playurl parsing, DASH video/audio safe download, FFmpeg merge, backup URL retry, and `BILIBILI_*` UI guidance. |
| `2026-06-27-admin-entitlement-adjustments-plan.md` | Added Admin Web manual entitlement and quota compensation with append-only audit records and completed browser smoke acceptance. |
| `2026-06-27-xiaohongshu-video-fallback-completion-plan.md` | Completed Xiaohongshu public video-note fallback with share/full/direct/short-link input acceptance, Brotli page compatibility, safe resumable video download, and `XHS_*` UI guidance. |
| `2026-06-23-desktop-one-click-updates-plan.md` | Implemented low-noise Tauri updater with GitHub Releases metadata/artifacts; live GitHub updater smoke is waived for v1 because mainland China GitHub access is too slow to test reliably. |
| `2026-06-26-easydownload-transcription-download-reliability-plan.md` | Added shared safe media download helpers, Douyin share-text parsing, and video-only Xiaohongshu public-link fallback for transcription-first media acquisition. |
| `2026-06-25-douyin-share-page-fallback-plan.md` | Added a bounded Douyin share-page fallback that selects the largest validated public stream after matching `yt-dlp` failures. |
| `2026-06-25-transcript-summary-mindmap-plan.md` | Added confirmed AI整理 outputs for transcript summaries and local Mermaid mindmap artifacts. |
| `2026-06-23-desktop-worker-structure-refactor-plan.md` | Split the desktop React shell, Tauri bridge, and Python worker orchestration into focused modules without behavior changes. |
| `2026-06-23-asr-model-cache-layout-plan.md` | Unified SenseVoice ASR cache layout under `<FRAMEQ_MODEL_DIR>/models/iic/...` and preserved legacy compatibility. |
| `2026-06-23-disable-root-dotenv-llm-plan.md` | Stopped applying repository-root `.env` to desktop worker runtime after LLM config moved to server-managed checkout. |
| `2026-06-22-four-artifact-split-flow-plan.md` | Split local transcript generation from confirmed insight generation and surfaced video/audio/transcript/insight artifacts. |
| `2026-06-22-server-managed-llm-quota-plan.md` | Added server-managed dedicated client LLM config, desktop checkout, and monthly insight quota. |
| `2026-06-18-macos-desktop-ui-upgrade-plan.md` | Upgraded the React desktop UI to a macOS-style utility shell |
| `2026-06-18-topic-planner-insights-plan.md` | Added LLM topic planning before insight question generation |
| `2026-06-18-insight-prompt-tuning-plan.md` | Aligned FrameQ insight prompts and generation parameters with the reference service |
| `2026-06-21-activation-code-authorization-plan.md` | Account login with Admin Web-issued activation codes as the visible unlock flow. |
| `2026-06-21-account-billing-plan.md` | Retired account entitlement foundation plan; current visible unlock flow is activation-code based. |
| `2026-06-17-sensevoice-modelscope-cache-plan.md` | Routed SenseVoice ModelScope cache into FrameQ's configured model directory |
| `2026-06-17-sensevoice-long-audio-vad-plan.md` | Improved SenseVoice long-audio VAD parameters and transcript tag cleanup |
| `2026-06-17-local-media-reuse-plan.md` | Reused existing local audio and selected downloaded media by Douyin video ID |
| `2026-06-17-sensevoice-asr-models-plan.md` | Added ASR model selection with SenseVoice Small and Qwen3-ASR |
| `2026-06-17-history-and-output-config-plan.md` | Added task history viewing and configurable output directory |
| `2026-06-17-ui-llm-configuration-plan.md` | Retired local desktop LLM configuration UI; current LLM config is managed by FrameQ server |
| `2026-06-16-mvp-desktop-client-plan.md` | Built and validated the MVP desktop client workflow from URL input to transcript and insight output |
| `2026-06-16-mvp-desktop-client-tasks.md` | Completed task checklist for the MVP desktop client ExecPlan |
