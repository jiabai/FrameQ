# App Composition Integration Coverage

**Date:** 2026-07-19  
**Status:** Approved for implementation by the user's conditional instruction on 2026-07-19

## Context

`app/src/App.tsx` is FrameQ's React composition root. It creates the workflow, History,
transcript, AI-generation, account, settings, model, update, and window controllers; connects
cross-controller callbacks; registers startup deep-link handling; and derives artifact-location
actions.

The audit claim that FrameQ has no real `<App />` lifecycle coverage is no longer fully accurate.
`app/tests/app-input.browser.test.ts` starts Vite, loads `main.tsx` in a real headless Chromium
target, mounts `<App />`, and already covers task submission, History restoration/deletion,
transcript save isolation, AI confirmation/cancellation, settings, localization, account sign-out,
and layout behavior. Controller and static-render tests supplement that browser suite.

Two composition-root connections remain unproved by the real-browser command ledger:

1. startup `frameq://auth/callback` URLs must reach `complete_auth_flow` through App's deep-link
   effect and account controller;
2. local workspace video/audio actions must derive the selected task artifact path in App and pass
   it to the Tauri opener plugin, then render the localized outcome.

## Decision

Extend the existing real-browser App smoke harness instead of adding a second DOM test stack or
mocking every controller in a synthetic `App.test.tsx`.

- `app/tests/app-input.browser.test.ts` remains the App integration-test owner and continues to load
  the production entrypoint rather than importing a reduced test shell.
- `app/tests/support/mockTauriBridge.ts` will allow the existing scenario response map to provide
  startup deep-link URLs. Its default remains an empty array, so all existing scenarios are
  unchanged.
- One browser test will provide a valid callback URL, assert exactly one `complete_auth_flow`
  command with the unchanged URL, and verify the account sheet reaches the localized completion
  state.
- One browser test will restore a real mock History task, click the rendered Locate Video action,
  assert `plugin:opener|reveal_item_in_dir` receives only the expected resolved artifact path, and
  verify the localized success notice.
- Existing tests remain the owners of controller-internal concurrency, gateway mapping, component
  rendering variants, and visual geometry. The new tests prove only cross-controller/App wiring.

## Alternatives considered

### Add Testing Library plus jsdom or happy-dom

Rejected. The project currently has no DOM-testing dependency, while a useful App render would need
to mock nine controllers and several Tauri plugins. That test would be faster but less representative
than the browser harness already included in `npm test`.

### Refactor App to inject every service and controller

Rejected for this task. It would change production architecture solely to add two characterization
tests. The existing Tauri bridge is already the correct process-boundary seam.

### Rely on controller tests only

Rejected. Controller tests prove local behavior but cannot prove that App registers the startup
effect, forwards the callback, selects the current task artifact, or wires the rendered button to
the opener plugin.

## Failure and privacy rules

- Test URLs and paths are synthetic and contain no credentials or user data.
- The deep-link assertion checks the exact Tauri request but does not log or snapshot arbitrary
  callback content.
- The artifact assertion permits only the expected task-owned path and must not weaken production
  path validation or introduce a test-only production API.
- A browser/runtime exception, duplicate callback command, wrong artifact path, missing localized
  notice, or unmounted App fails the focused suite.

## Verification

- Demonstrate RED for startup deep-link delivery while the bridge still hardcodes an empty current
  URL list.
- Make the minimal bridge change and demonstrate GREEN.
- Add the artifact-location characterization test against existing production behavior.
- Run the focused browser file, the complete app suite, lint, production build, governance
  validation, and `git diff --check`.

No Rust, Python worker, server, product behavior, IPC schema, security boundary, or dependency
version changes are in scope.
