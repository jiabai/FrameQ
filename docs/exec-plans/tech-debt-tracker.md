# Tech Debt Tracker

Last updated: 2026-06-17

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| None | No high-priority MVP debt remains after final validation | N/A | N/A |

## Recently Closed

| Topic | Evidence | Closed |
|------|----------|--------|
| Real InsightFlow LLM live call not smoke-tested | Project `.env` uses `FRAMEQ_LLM_PROVIDER=openai_compatible`, SiliconFlow base URL, a real API key, and `deepseek-ai/DeepSeek-V3.2`; retry smoke on `outputs/7524373044106677544_transcript.txt` returned `completed`, generated 8 insights, and wrote `outputs/7524373044106677544_insights.json` | 2026-06-17 |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
