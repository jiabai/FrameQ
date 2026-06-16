# Tech Debt Tracker

Last updated: 2026-06-16

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| Real Qwen3-ASR inference not verified | Adapter and writers are tested, but model weights have not been downloaded or executed on the sample WAV | `docs/exec-plans/active/2026-06-16-mvp-desktop-client-plan.md` | Run Qwen3-ASR on `work/7524373044106677544.wav` and replace fake transcript validation with real output |
| ASR model cache/download UX not implemented | The worker CLI deliberately returns `ASR_MODEL_NOT_READY` unless `FRAMEQ_ALLOW_REAL_ASR=1`, preventing surprise large model downloads from the desktop UI | `worker/frameq_worker/cli.py` | Add explicit model cache/download progress UX and allow real ASR through product settings or a documented setup path |
| Real InsightFlow LLM call not configured | Embedded generator and output writers are tested with a fake client; production LLM credentials/client wiring still need configuration | `worker/frameq_worker/insightflow/` | Configure an LLM client, run generation on a real transcript, and verify `insights.json` comes from the configured LLM |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
