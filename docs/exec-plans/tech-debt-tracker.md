# Tech Debt Tracker

Last updated: 2026-06-16

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| ASR model download/loading progress UX not implemented | The worker now supports `models/` / `FRAMEQ_MODEL_DIR` cache placement and real ASR is verified, but the desktop UI cannot yet show model download or load progress during the long ASR startup path | `worker/frameq_worker/asr.py`, `app/src/App.tsx` | Add explicit model download/loading progress UX and allow real ASR through product settings or a documented setup path |
| Real InsightFlow LLM call not configured | Embedded generator and output writers are tested with a fake client; production LLM credentials/client wiring still need configuration | `worker/frameq_worker/insightflow/` | Configure an LLM client, run generation on a real transcript, and verify `insights.json` comes from the configured LLM |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
