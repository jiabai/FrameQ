# Desktop Process Supervision and Cancellation

## Problem

The desktop currently records a worker or ASR model-download PID in two separate state holders. It can mark cancellation before tree termination is confirmed, clear the PID before the child actually exits, and on Unix signal only the Python parent. This can leave downloader/transcoder descendants running and make a normal late result appear cancelled.

## Product Behavior

- A user cancellation moves a running video task or model download to a visible `Cancelling` state. The UI stays attached to that operation and shows “正在取消”; it does not clear the workflow or invalidate its operation ID immediately.
- A confirmed cancelled terminal result returns the video workflow to input while retaining the submitted URL for a retry. Model download shows a confirmed cancelled state and keeps all existing model files/cache.
- If a termination request fails, the operation returns to its observable running state with a clear error. It continues to receive progress and its actual later result.
- If natural completion wins a race with cancellation, FrameQ presents the real successful/partial/failed result rather than discarding it merely because cancellation was requested.
- Existing outputs, cache files, and ASR model files are never automatically deleted by cancellation.

## Runtime Boundary

- `ProcessSupervisor` is the only in-process authority for a current worker/model-download child. It owns a monotonically increasing running-instance identifier, PID, and phase: `Running` or `Cancelling`; absence is the finished state.
- Cancellation atomically claims a matching `Running` instance before issuing any signal. A second request for the same instance reports that cancellation is already in progress; stale finish/clear operations must match the running-instance identifier, not only a PID.
- Windows uses `taskkill /PID <pid> /T /F` for the full tree.
- macOS spawns the worker in a new process group. Cancellation sends TERM to the negative PGID, waits only for a bounded TERM-to-KILL escalation grace period, and sends KILL to the same group if descendants remain. Command arguments are constructed from supervisor-owned numeric IDs and never through a shell.
- Signal delivery is distinct from terminal observation. A successful signal produces `cancelling`; only the eventual child result establishes whether the terminal state is cancelled or a real completion/failure.

## Scope and Non-goals

- Video workers and ASR model downloads use the same supervisor semantics. Worker-created `yt-dlp`, FFmpeg, and fallback descendants are included through the process group/tree.
- Supported desktop release platforms are Windows and macOS. Linux packaging, release validation, and support claims are out of scope.
- IPC may expose structured cancellation status, but frontend code must not infer process state from error-message text.
- This does not add external process-management dependencies, change output cleanup policy, alter server billing/entitlement/admin behavior, invoke real payment APIs, or make a production payment claim.

## Acceptance Criteria

- Tests cover failed termination, duplicate cancel, finish/cancel races, stale instance state, Windows tree command construction, Unix process-group TERM/KILL command construction, and shared worker/ASR semantics.
- The macOS CI suite executes the Unix-gated controlled parent-plus-child fixture and verifies that it is terminated as a group; Windows reports that this live process-group check is not executable on the current platform.
- Frontend tests prove a failed cancel does not reset the workflow and a confirmed cancellation does; model-download state follows the same lifecycle.
