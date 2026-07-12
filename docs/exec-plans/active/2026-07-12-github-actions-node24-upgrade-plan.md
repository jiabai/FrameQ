# GitHub Actions Node.js 24 Runtime Upgrade Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision
> Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

Remove the hosted-runner warning caused by JavaScript actions that still target Node.js 20. The
change updates only reusable GitHub Action versions and their contract tests. It does not alter the
FrameQ application, packaged Node.js choice, release artifacts, payment, LLM, worker, or user data
flows, and it must not create or modify a GitHub Release.

## Progress

- [x] 2026-07-12: Confirmed the warning sources and reviewed official Node.js 24-capable versions.
  Validation: repository scan found checkout v4, setup-node v4, and setup-uv v6 in three workflows;
  official action metadata confirms checkout v5, setup-node v5, setup-uv v8.3.2, and
  upload-artifact v6 use Node.js 24.
- [x] 2026-07-12: Updated workflow contract tests first and recorded RED against the old actions.
  Validation: focused suite had 3 expected failures for Desktop Release, Intel acceptance, and
  ProcessSupervisor action versions while the other 3 boundary tests passed.
- [x] 2026-07-12: Applied the minimal action upgrades and recorded GREEN. Validation: focused suite
  passed 6/6, full script suite passed 15/15, the old-version scan returned no matches, docs
  validation returned 0 errors / 0 warnings, and `git diff --check` passed.
- [ ] 2026-07-12: Push the isolated branch and obtain real hosted macOS ProcessSupervisor and Intel
  acceptance green runs with no Node.js 20 action-runtime annotation. Validation: run/job evidence.
- [ ] 2026-07-12: Integrate to main, close the technical debt, archive this plan, and run final
  governance/diff checks. Validation: local/remote main match and original uncommitted work remains
  untouched.

## Surprises & Discoveries

- Evidence: the Node.js warning concerns the action implementation runtime, not FrameQ's frontend
  or bundled runtime. Changing only `node-version` would not remove it.
- Evidence: `desktop-release.yml` contains three copies of each affected action, while
  `macos-intel-acceptance.yml` contains all three and `unix-process-supervisor.yml` contains only
  checkout.
- Evidence: Intel acceptance run `29197874978` failed during `Set up job` before checkout or secret
  use with `Unable to resolve action astral-sh/setup-uv@v8`. The official setup-uv README publishes
  immutable commit `11f9893b081a58869d3b5fccaea48c9e9e46f990` for v8.3.2 instead of a floating
  `v8` tag.
- Evidence: the first otherwise-successful Intel acceptance run `29197962507` exposed one more
  hosted warning from `actions/upload-artifact@v4`. The warning is not observable from the initial
  checkout/setup scan alone; the action's official v6 release changes `runs.using` to Node.js 24.

## Decision Log

- Decision: Use `actions/checkout@v5`, `actions/setup-node@v5`, and the immutable
  `astral-sh/setup-uv@11f9893...` commit for v8.3.2. Rationale: checkout/setup-node v5 are the
  smallest Node.js 24-capable major upgrades; setup-uv v8.3.2 explicitly declares `using: node24`
  but does not publish a resolvable floating `v8` tag, so the official README's commit-SHA form is
  both functional and supply-chain safer. Date/Author: 2026-07-12 / User + Codex.
- Decision: Upgrade Intel artifact upload from `actions/upload-artifact@v4` to v6, not v5.
  Rationale: official action metadata shows v5 still declares Node.js 20, while v6 is the smallest
  compatible major that defaults to Node.js 24; the hosted GitHub runner already exceeds its
  minimum runner requirement. Date/Author: 2026-07-12 / Codex.
- Decision: Do not trigger Desktop Release. Rationale: contract tests can protect its YAML shape,
  and real Node.js 24 execution is safely proven by the non-release ProcessSupervisor and Intel
  acceptance workflows without creating assets or release state. Date/Author: 2026-07-12 / Codex.

## Outcomes & Retrospective

TDD and local validation are complete. The implementation changes only 13 `uses:` references and
three focused workflow test files (including the new Desktop Release contract). Hosted workflow run
IDs, annotation results, final integration commit, and remaining risks will be recorded after the
branch is pushed and both non-release workflows finish.

Residual risk: major action tags are mutable upstream references, matching the repository's current
dependency policy. Commit-SHA pinning remains a separate supply-chain hardening decision.

## Context and Orientation

- Workflows: `.github/workflows/desktop-release.yml`,
  `.github/workflows/macos-intel-acceptance.yml`, and
  `.github/workflows/unix-process-supervisor.yml`.
- Tests: `scripts/tests/macos-intel-acceptance-workflow.test.mjs`,
  `scripts/tests/unix-process-supervisor-workflow.test.mjs`, and new
  `scripts/tests/desktop-release-workflow.test.mjs`.
- Governance: `docs/exec-plans/tech-debt-tracker.md`, `TASKS.md`, `AGENTS.md`, and ExecPlan indexes.

## Plan of Work

1. Add/modify focused workflow tests to require checkout v5, setup-node v5, setup-uv v8.3.2, and
   upload-artifact v6 and to reject their Node.js 20-era versions.
2. Run the focused tests and confirm RED against the current YAML.
3. Update only the `uses:` action references in the three workflows.
4. Run focused tests, all script tests, documentation validation, and `git diff --check`.
5. Push the branch and manually dispatch the macOS ProcessSupervisor and Intel acceptance
   workflows against the branch; inspect conclusions and annotations.
6. Close the tracked debt only after both hosted workflows are green without the Node.js 20 action
   warning, then integrate to main and archive the plan.

## Validation and Acceptance

```powershell
node --test scripts\tests\desktop-release-workflow.test.mjs scripts\tests\macos-intel-acceptance-workflow.test.mjs scripts\tests\unix-process-supervisor-workflow.test.mjs
node --test scripts\tests\*.test.mjs
python scripts\validate_agents_docs.py --level WARN
git diff --check
git status --short
```

Hosted acceptance:

- `macOS ProcessSupervisor` succeeds against this branch and contains no Node.js 20 deprecation
  annotation.
- `macOS Intel Acceptance Artifact` succeeds against this branch and contains no Node.js 20
  deprecation annotation.
- No Desktop Release run, tag, release asset, payment, LLM, or platform download is created.
