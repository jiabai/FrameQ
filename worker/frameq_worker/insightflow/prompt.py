from __future__ import annotations

import json

from frameq_worker.models import PreferenceSnapshot
from frameq_worker.output_language import (
    OutputLanguage,
    output_language_semantics,
)


def build_topic_plan_prompt(
    text: str,
    output_language: OutputLanguage,
    max_topics: int = 8,
    max_questions: int = 12,
    preference_snapshot: PreferenceSnapshot | None = None,
) -> str:
    semantics = output_language_semantics(output_language)
    preference_prompt_section = ""
    if preference_snapshot is not None:
        preference_prompt_section = f"""
## Personalization snapshot
Use this JSON only to select, rank, and assign `question_count` to topic segments.
Do not use it for a summary or mindmap. Prefer `generationPreferences` when ranking
segments; use `labelSnapshot` only to understand option meaning.
```json
{format_preference_snapshot_for_prompt(preference_snapshot)}
```
"""

    return f"""
# Role
You are a topic-segment planner. Do not generate questions yet. Divide an ASR transcript
that may have no natural sections into semantic topic segments suitable for later inspiration.

## Output-language contract
{semantics.prompt_instruction}

## Task
Extract at most {max_topics} high-value topic segments from the transcript ({len(text)} characters).
{preference_prompt_section}

## Planning rules
- Ignore greetings, repetition, filler, empty setup, and transitions.
- Prefer viewpoints, methods, conflicts, experience, decisions, industry judgment, and
  implementation value.
- Personalization may affect only priority, order, and `question_count`; never invent facts.
- The transcript wins whenever a preference conflicts with it.
- Keep one main subject per segment.
- `excerpt` must come from the transcript or faithfully compress its wording.
- Set `question_count` from 1 through 3 according to topic density.
- The sum of all `question_count` values must not exceed {max_questions}.

## Output format
- Output only a JSON array, with no explanation, Markdown wrapper, or extra text.
- Keep these JSON keys and this schema exactly:
```json
[
  {{
    "id": 1,
    "title": "{semantics.topic_example_title}",
    "summary": "{semantics.topic_example_summary}",
    "excerpt": "{semantics.topic_example_excerpt}",
    "question_count": 2
  }}
]
```

## Transcript
{text}
"""


def build_question_prompt(
    text: str,
    number: int,
    output_language: OutputLanguage,
    global_prompt: str = "",
    question_prompt: str = "",
    preference_snapshot: PreferenceSnapshot | None = None,
) -> str:
    semantics = output_language_semantics(output_language)
    global_prompt_section = ""
    if global_prompt:
        global_prompt_section = f"""
## Additional global constraints
{global_prompt}
"""

    question_prompt_section = ""
    if question_prompt:
        question_prompt_section = f"""
## Additional constraints for this request
{question_prompt}
"""

    preference_prompt_section = ""
    if preference_snapshot is not None:
        preference_prompt_section = f"""
## Personalization snapshot
Use this JSON only to generate inspiration, not a summary or mindmap.
Prefer `generationPreferences`; use `labelSnapshot` only to understand option meaning.
```json
{format_preference_snapshot_for_prompt(preference_snapshot)}
```
"""

    return f"""
# Role
You are a reflective reading partner and topic curator. Do not turn the source into a
reading-comprehension quiz. Extract open-ended, transferable questions that invite deeper thought.
{global_prompt_section}
{preference_prompt_section}

## Output-language contract
{semantics.prompt_instruction}

## Task
Generate at least {number} high-quality questions from the text ({len(text)} characters).
Every question must be a transferable topic question.
{question_prompt_section}

## Generation rules
- Prefer transferable industry, method, organization, decision, and implementation angles.
- Do not ask readers to repeat what a named company, person, or product did.
- Treat names as case context, not the grammatical subject of the question by default.
- Make each question open, concrete, discussable, natural, and easy to understand.
- Keep one main thought per question and avoid nested clauses or abstract noun piles.
- Do not generate fact checks, definitions, summaries, exams, or translation-like templates.

## Output format
- Output a valid JSON array only.
- Keep these JSON keys and this schema exactly:
```json
[
  {{
    "topic": "{semantics.question_example_topic}",
    "matchReason": "{semantics.question_example_reason}",
    "followUpQuestions": ["{semantics.question_example_follow_up}"],
    "suitableUse": "{semantics.question_example_use}"
  }}
]
```

## Source text
{text}
"""


def format_preference_snapshot_for_prompt(snapshot: PreferenceSnapshot) -> str:
    return json.dumps(
        {
            "profile": _profile_to_prompt_dict(snapshot),
            "profileSkipped": snapshot.profile_skipped,
            "generationPreferences": {
                "goal": snapshot.generation_preferences.goal,
                "scenario": snapshot.generation_preferences.scenario,
                "angles": list(snapshot.generation_preferences.angles),
                "audience": snapshot.generation_preferences.audience,
                "styles": list(snapshot.generation_preferences.styles),
                "avoid": list(snapshot.generation_preferences.avoid),
            },
            "labelSnapshot": {
                "profile": [
                    _label_snapshot_item_to_prompt_dict(item)
                    for item in snapshot.label_snapshot.profile
                ],
                "generationPreferences": [
                    _label_snapshot_item_to_prompt_dict(item)
                    for item in snapshot.label_snapshot.generation_preferences
                ],
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _profile_to_prompt_dict(snapshot: PreferenceSnapshot) -> dict[str, object] | None:
    if snapshot.profile is None:
        return None
    return {
        "role": snapshot.profile.role,
        "domain": snapshot.profile.domain,
        "stage": snapshot.profile.stage,
        "cityContext": snapshot.profile.city_context,
        "genderPerspective": snapshot.profile.gender_perspective,
        "platforms": list(snapshot.profile.platforms),
        "defaultStyles": list(snapshot.profile.default_styles),
        "defaultAvoid": list(snapshot.profile.default_avoid),
    }


def _label_snapshot_item_to_prompt_dict(item) -> dict[str, object]:
    return {
        "field": item.field,
        "label": item.label,
        "values": [
            {
                "id": value.id,
                "label": value.label,
            }
            for value in item.values
        ],
    }


def build_mindmap_prompt(
    text: str,
    output_language: OutputLanguage,
) -> str:
    semantics = output_language_semantics(output_language)
    return f"""
# Role
You organize logical mindmaps. Extract the transcript's main line, branches, and hierarchy,
then produce Mermaid mindmap source that can be saved directly to a local file.

## Output-language contract
{semantics.prompt_instruction}

## Task
Organize the transcript ({len(text)} characters) into a clear mindmap.

## Generation rules
- Prefer viewpoints, methods, causes, steps, conflicts, conclusions, and transferable experience.
- Remove greetings, repetition, filler, and empty transitions.
- Use the top node for the central subject and lower levels for branches and supporting points.
- Keep node labels short; do not write paragraph-length nodes.
- Do not add facts, numbers, people, or conclusions absent from the transcript.

## Output format
- Output only Mermaid mindmap source, with no explanation, code fence, or extra text.
- The first line must be `mindmap`.
- Preserve Mermaid syntax. Example:
mindmap
  root(({semantics.mindmap_example_root}))
    {semantics.mindmap_example_branch}
      {semantics.mindmap_example_point}

## Transcript
{text}
"""


def build_summary_prompt(
    transcript_markdown: str,
    mermaid_mindmap: str,
    output_language: OutputLanguage,
) -> str:
    semantics = output_language_semantics(output_language)
    return f"""
# Role
You are a summary editor. Create a Key Summary from the source Transcript and Mermaid mindmap.

## Output-language contract
{semantics.prompt_instruction}

## Inputs
### Transcript
{transcript_markdown}

### Mermaid mindmap
{mermaid_mindmap}

## Output requirements
- Output only the Markdown summary body, without Mermaid source, code fences, or reasoning.
- Start with the exact heading `# {semantics.summary_title}`.
- Then use `## {semantics.summary_overview_title}` followed by 2 through 6 topic sections
  with concise bullet points.
- Stay faithful to the Transcript. The Mermaid mindmap may organize logic but adds no facts.
- Make the result suitable for direct UI display and copying; avoid empty generalities.
"""
