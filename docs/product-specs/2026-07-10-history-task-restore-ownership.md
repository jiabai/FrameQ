# History Task Restore Ownership

## Problem

The workflow controller protects active worker and AI-retry callbacks with an operation ID, but `App` can directly replace the workflow with a history item through a shared raw setter. Selecting history while video processing, AI retry, or cancellation is active can therefore leave old progress/results able to overwrite the restored task or combine one task's text/artifacts with another task's identity.

## Product Behavior

- The workflow controller is the sole owner of task-identity replacement. It exposes a semantic `restoreHistoryItem` action and does not expose a generic workflow setter to App, History, or other features.
- History can still be opened while a workflow is active, but its task rows are read-only and disabled with accessible explanatory copy. Video processing, AI retry, and `cancelling` are all active states; selecting a history row in any of them is rejected without changing the current workflow or cancelling the active task.
- When the workflow is stable, selecting a lightweight history row first loads that current-safe task through `get_history_detail(taskId)`. Only the latest completed detail response is forwarded to the workflow controller; restoration then invalidates the prior operation ID, resets task-scoped transient UI, and replaces the entire task state from exactly that detail. Task ID, directory, artifacts, text, summary, and insights must remain from the same selected task.
- After a successful restore, any stale progress or terminal result from an older operation is ignored by the existing operation-ID guard.
- Task-local editing remains supported through a constrained callback that applies a transcript save only when its expected task ID is still current. It cannot replace a task identity or merge a save from an old task into a newly restored task.

## Boundaries

- `useHistoryController` owns fetching, panel open/close state, and forwarding a selection event only. It does not determine whether restoration is allowed and does not mutate workflow state.
- `useTaskProcessingController` owns activity detection, history-restore authorization, operation-ID invalidation, task identity replacement, URL draft updates, and guarded task-local updates.
- `App` is composition only: it passes controller actions to the history sheet and transcript-detail controller, and provides the existing reset callback that closes details, preference flows, and notices.
- This change does not alter ProcessSupervisor signal/tree behavior, server entitlement/payment flows, history persistence, or worker artifact formats.

## Acceptance

- Active video, AI retry, and cancelling workflows reject history selection and still display their real terminal result.
- Stable restoration atomically presents only the selected history task's identity and artifacts, then ignores stale old-operation callbacks.
- The history sheet gives disabled rows a visible reason and native keyboard-inaccessible disabled behavior while restoration is unavailable.
- Transcript saves remain task-local and cannot update a different restored task.
