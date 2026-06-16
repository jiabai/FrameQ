# Tech Debt Tracker

Last updated: 2026-06-16

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| Real InsightFlow LLM live call not smoke-tested | `.env` configuration and OpenAI-compatible client wiring are implemented, but this branch does not include a real API key or live provider response | `worker/frameq_worker/llm.py` | Fill `.env` with a real provider key/model, run retry or full generation on a real transcript, and verify `insights.json` comes from the configured LLM |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
