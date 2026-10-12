from __future__ import annotations

import json

from frameq_worker.insightflow.splitter import MarkdownChunk
from frameq_worker.models import Insight, PreferenceSnapshot
from frameq_worker.output_language import (
    OutputLanguage,
    output_language_semantics,
)

_MAP_SCHEMA_EXAMPLE = {
    "segments": [
        {
            "title": "segment title",
            "sourceChunkIds": [1],
            "coreClaim": "source-grounded core claim",
            "supportingPoints": ["source-grounded supporting point"],
            "rhetoricalDevices": ["rhetorical device and its effect"],
            "rhythmNote": "textual information-rhythm observation",
            "reusablePattern": (
                "must-keep structural function; replaceable [content slot]; optional node; "
                "applicable type"
            ),
            "riskFlags": ["segment-specific inapplicability or cautious verification note"],
        }
    ],
    "highlights": ["verbatim quotation from the supplied chunks"],
    "strengths": ["source-grounded strength"],
    "weaknesses": ["source-grounded weakness or global transfer limitation"],
}

_FINAL_SCHEMA_EXAMPLE = {
    "overallNarrative": {
        "openingHook": "opening hook or null",
        "structureType": "overall progression structure",
        "turningPoint": "turning point or null",
        "closingType": "closing type or null",
    },
    "segments": [
        {
            "id": 1,
            "title": "segment title",
            "sourceChunkIds": [1],
            "coreClaim": "source-grounded core claim",
            "supportingPoints": ["source-grounded supporting point"],
            "rhetoricalDevices": ["rhetorical device and its effect"],
            "rhythmNote": "textual information-rhythm observation",
            "reusablePattern": (
                "must-keep structural function; replaceable [content slot]; optional node; "
                "applicable type"
            ),
            "riskFlags": ["segment-specific inapplicability or cautious verification note"],
        }
    ],
    "highlights": ["verbatim quotation present in map data"],
    "reusableTemplate": {
        "name": "template name",
        "skeleton": [
            "Required: introduce [audience problem]",
            "Required: support with [core evidence]",
            "Optional: close with [next action]",
        ],
    },
    "audienceFit": [
        {"audience": "audience", "fit": "high", "note": "source-grounded reason"}
    ],
    "strengths": ["source-grounded strength"],
    "weaknesses": ["source-grounded weakness or global transfer limitation"],
}


def _schema_example(value: dict[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def build_dissection_map_prompt(
    chunks: list[MarkdownChunk],
    output_language: OutputLanguage,
) -> str:
    semantics = output_language_semantics(output_language)
    source = [{"id": chunk.id, "content": chunk.content} for chunk in chunks]
    valid_chunk_ids = [chunk.id for chunk in chunks]
    return f"""# Transcript dissection map stage
{semantics.prompt_instruction}
Act as a senior content editor performing text-only structural analysis. Analyze only the supplied
transcript chunks. Do not infer visual, audio, speaking-rate, editing, or conversion performance.

## Analysis dimensions
- Identify meaningful topic segments and boundaries, not arbitrary sentence groups.
- For every segment, state its core claim, supporting points, rhetorical devices and their effect,
  textual information rhythm, a transferable writing pattern, and cautious risk flags.
- Treat risk flags only as claims that may need verification or judgments that may be controversial;
  never present them as completed fact-checks.
- Make reusable patterns actionable for writing transfer, but do not copy source wording as a
  template or invent a product, audience, outcome, or fact.
- Treat reuse as writing and content-structure transfer only. Each `reusablePattern` must name the
  structural function that must remain, show replaceable bracketed slots such as `[audience need]`
  or `[core evidence]`, identify every optional or removable node, include applicable content types,
  and state any source-grounded inapplicability condition.
- Put segment-specific inapplicability and transfer risks in `riskFlags`; put global limitations,
  identity/evidence dependencies, and cases where the structure should not be reused in
  `weaknesses`.
- Never claim to analyze shots, camera movement, voice, music, captions, or equipment. Do not infer
  conversion performance from transcript text.

## Output contract
- Return JSON only, without Markdown fences, commentary, or extra text.
- Return one closed object with exactly these four keys: `segments`, `highlights`, `strengths`, and
  `weaknesses`. Objects at every level must contain exactly the keys shown in the schema example.
- Return 1 through 8 segments for this batch. `supportingPoints`, `rhetoricalDevices`, and
  `riskFlags` each contain at most 6 concise strings.
- `highlights` contains at most 8 quotations. Every highlight must be a character-for-character
  substring of a supplied chunk's content: copy the exact original wording including punctuation
  and spacing; do not paraphrase, summarize, translate, or normalize a quotation.
- `strengths` and `weaknesses` each contain at most 6 source-grounded strings.
- Every `sourceChunkIds` array is non-empty, ascending, deduplicated, and contains only IDs from
  this batch. Legal sourceChunkIds for this batch: {valid_chunk_ids}
- Do not add facts, preferences, paths, URLs, prior AI results, or unknown fields.

## Exact intermediate JSON schema example
{_schema_example(_MAP_SCHEMA_EXAMPLE)}

## Transcript chunks
{json.dumps(source, ensure_ascii=False, separators=(",", ":"))}
"""


def build_dissection_reduce_prompt(
    map_results: list[dict[str, object]],
    output_language: OutputLanguage,
) -> str:
    semantics = output_language_semantics(output_language)
    return f"""# Transcript dissection reduce stage
{semantics.prompt_instruction}
Act as a senior content editor. Combine only the structured map results; do not add source text,
facts, preferences, paths, URLs, prior AI results, or visual/audio claims.

## Output contract
- Return JSON only, without Markdown fences, commentary, or extra text.
- Return one closed object with exactly these keys: `overallNarrative`, `segments`, `highlights`,
  `reusableTemplate`, `audienceFit`, `strengths`, and `weaknesses`. Nested objects must contain
  exactly the keys shown in the schema example.
- `openingHook`, `turningPoint`, and `closingType` are either a non-empty string or null.
  `structureType` is always a non-empty string.
- Segment `id` values are sequential integers starting at 1. Every `sourceChunkIds` array is
  non-empty, ascending, deduplicated, and uses only IDs present in the map results.
- `supportingPoints`, `rhetoricalDevices`, and `riskFlags` are arrays of concise strings. Risk flags
  use cautious language and never claim that fact-checking has been completed.
- `highlights` contains at most 8 items. Every item is a verbatim quotation carried
  character-for-character from map data; never paraphrase, summarize, translate, or normalize a
  quotation and still label it as source text.
- `reusableTemplate.skeleton` contains 3 through 7 actionable, transferable writing steps and does
  not copy the source verbatim; preserve must-keep nodes, use replaceable bracketed slots in the
  required output language, mark every step as required or optional/removable, and include
  applicable content types in the template or corresponding segment patterns.
- Preserve optional or removable nodes and source-grounded applicability information from map data.
  Route segment-specific limits to `riskFlags` and store global transfer limits in `weaknesses`,
  including global inapplicability and identity- or evidence-dependent constraints.
- Do not invent a product, audience, performance outcome, or use case. Limit recommendations to
  writing and content-structure transfer; never claim analysis of shots, camera movement, voice,
  music, captions, equipment, editing, or conversion performance.
- Every `audienceFit.fit` is exactly one of `"high" | "medium" | "low"` and its note is grounded in
  the map results.
- `strengths` and `weaknesses` each contain at most 6 source-grounded strings.

## Exact final semantic JSON schema example
{_schema_example(_FINAL_SCHEMA_EXAMPLE)}

## Structured map results
{json.dumps(map_results, ensure_ascii=False, separators=(",", ":"))}
"""


def build_dissection_repair_prompt(
    invalid_result: object,
    output_language: OutputLanguage,
    *,
    valid_chunk_ids: tuple[int, ...],
    validation_category: str,
) -> str:
    semantics = output_language_semantics(output_language)
    return f"""# Transcript dissection repair stage
{semantics.prompt_instruction}
Repair this structured candidate to the exact final semantic schema below.

## Repair context
- Validation category: {validation_category}
- Legal sourceChunkIds: {list(valid_chunk_ids)}

## Repair rules
- Return JSON only, without Markdown fences, commentary, or extra text.
- You may add required schema fields that are missing and remove unknown fields.
- Populate added fields only by reorganizing evidence already present in the candidate. Use null for
  missing optional narrative fields and empty arrays where the schema permits them.
- Do not invent facts, quotations, or chunk IDs. Never use a chunk ID outside the legal list.
- When the validation category is `quotation_provenance`, every highlight must be a
  character-for-character quotation carried verbatim from the candidate's source-grounded fields;
  do not paraphrase, summarize, translate, or normalize a quotation.
- Preserve every valid source-grounded value that already satisfies the schema.
- Repair structure and preserve actionable reuse guidance already present in the candidate,
  including required versus optional nodes and replaceable bracketed slots.
- Preserve applicability and inapplicability plus transfer risks. Repair
  structure only; do not manufacture missing transfer evidence, products, audiences, outcomes, or
  use cases.
- Keep advice limited to writing and content-structure transfer. Never add claims about shots,
  camera movement, voice, music, captions, equipment, editing, or conversion performance.
- Enforce sequential segment IDs, ordered unique non-empty sourceChunkIds, the
  `"high" | "medium" | "low"` fit enum, at most 8 highlights, at most 6 strengths and weaknesses,
  and 3 through 7 reusable-template steps.

## Exact final semantic JSON schema example
{_schema_example(_FINAL_SCHEMA_EXAMPLE)}

## Invalid structured candidate
{json.dumps(invalid_result, ensure_ascii=False, separators=(",", ":"))}
"""


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
Do not use it for a summary or mindmap. Treat `profile.platforms` as background context.
If it differs from `generationPreferences.scenario`, follow the current scenario.
Transcript evidence wins over all preferences.
Use `labelSnapshot` only to understand option meaning.
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
Treat `profile.platforms` as background context. If it differs from
`generationPreferences.scenario`, follow the current scenario.
Transcript evidence wins over all preferences.
Use `labelSnapshot` only to understand option meaning.
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


# draft 目标平台词表：9 个稳定英文 id。映射表 + 透传显示名 + 合法 id 集合
# 同处定义，作为单一事实源——requests.parse_retry_insights_request 也导入
# DRAFT_PLATFORM_IDS 做校验，避免前后端两份词表漂移。
_DRAFT_PLATFORM_LABELS: dict[str, str] = {
    "wechat_official_account": "微信公众号",
    "xiaohongshu": "小红书",
    # 短视频系（视频号 / 抖音 / Tiktok / X）统一走「抖音」文体。
    "wechat_channels": "抖音",
    "douyin": "抖音",
    "tiktok": "抖音",
    "twitter": "抖音",
}

# 透传分支：取显示名原样写进 prompt「目标平台：{显示名}」，不挂特定文体（兜底）。
_DRAFT_PLATFORM_PASSTHROUGH_LABELS: dict[str, str] = {
    "bilibili": "B站",
    "youtube": "Youtube",
    "other": "其他",
}

# 9-id 合法词表（映射键 ∪ 透传键）。词表外 id 视为非法，由 request 校验拦截。
DRAFT_PLATFORM_IDS: frozenset[str] = frozenset(
    _DRAFT_PLATFORM_LABELS.keys() | _DRAFT_PLATFORM_PASSTHROUGH_LABELS.keys()
)


def _platform_label_for_draft_platform(platform_id: str) -> str:
    """Map a user-selected draft platform id to the prompt「目标平台」form label.

    短视频系合并到「抖音」；公众号→微信公众号；小红书→小红书；bilibili/youtube/other
    取透传显示名。词表外的 id（校验上游已拦）原样透传，绝不臆造平台文体。
    """
    if platform_id in _DRAFT_PLATFORM_LABELS:
        return _DRAFT_PLATFORM_LABELS[platform_id]
    return _DRAFT_PLATFORM_PASSTHROUGH_LABELS.get(platform_id, platform_id)


def build_draft_from_inspiration_prompt(
    seed: Insight,
    preference_snapshot: PreferenceSnapshot | None,
    output_language: OutputLanguage,
    summary: str | None = None,
    *,
    platform: str,
) -> str:
    """构造「生成文字稿」种子 prompt。

    字段映射：
    - ``seed.topic`` → 中央议题 / 标题方向。
    - ``seed.follow_up_questions`` → 章节骨架 / 子论点。
    - ``platform`` → 目标平台（用户在确认页所选 id；经 ``_platform_label_for_draft_platform``
      映射成文体标签，不再读 ``seed.suitable_use``）。
    - ``seed.match_reason`` → 目标感锚点，防跑题。
    - ``preference_snapshot`` → 偏好（语气/受众/角度/回避）。缺失 → 不进行个性化，
      绝不臆造角色 / 领域 / 风格。
    - ``seed.source_chunk_id`` → 仅作溯源标注；其文字稿片段正文一律不进入 prompt。
    - ``summary`` → 可选的原视频要点总结 grounding；为 None 时整体省略。
    - ``output_language`` → 冻结的 UI 语言闭集；注入语言指令，成稿正文必须使用该语言。
    """
    semantics = output_language_semantics(output_language)
    platform_label = _platform_label_for_draft_platform(platform)

    skeleton_lines = "\n".join(
        f"- {q}" for q in seed.follow_up_questions
    ) if seed.follow_up_questions else "- （灵感未提供章节骨架，请按目标平台文体自行规划）"

    source_annotation = (
        f"## 溯源标注\n灵感来源于原视频第 {seed.source_chunk_id} 段；"
        "本段文字稿原文不进入本 prompt，请基于检索与上述灵感字段成稿。\n"
        if seed.source_chunk_id is not None
        else ""
    )

    if preference_snapshot is not None:
        preference_section = (
            "## 偏好快照（个性化：语气 / 受众 / 角度 / 回避）\n"
            "以下 JSON 仅用于调整成稿的语气、受众、角度与回避项，不得用来补充灵感之外的"
            "事实或观点；与灵感事实冲突时以灵感为准。\n"
            "```json\n"
            f"{format_preference_snapshot_for_prompt(preference_snapshot)}\n"
            "```\n"
        )
    else:
        preference_section = (
            "## 偏好快照（个性化：语气 / 受众 / 角度 / 回避）\n"
            "本次未提供偏好快照——不进行个性化，也不要臆造任何角色、领域、受众或风格；"
            "按目标平台通用文体成稿即可。\n"
        )

    summary_section = ""
    # 「在场」语义与 draft_agent._summary_is_present 保持一致：非 None 且 strip 后
    # 非空。纯空白 summary 按缺失处理，避免与系统侧 prompt 矛盾。
    if summary is not None and summary.strip():
        summary_section = (
            "## 原视频要点总结（可选 grounding）\n"
            "以下要点总结来自原视频，可作为观点来源与事实 grounding；"
            "引用其观点时按原创性规则标注来源，不要原样复制整段。\n"
            f"{summary}\n"
        )

    return f"""
# 角色使命
你是一位内容成稿编辑。你的任务是把一条「灵感」扩展成一篇完整、可直接发布的稿子。

## 输出语言（强制）
{semantics.prompt_instruction}
成稿正文的每个用户可见值（标题、正文、小节标题）都必须使用上述目标语言；
本 prompt 中的中文指令文本不是成稿内容，不要照抄进正文。

## 灵感（中央议题 / 标题方向）
{seed.topic}

## 目标感锚点（防跑题）
{seed.match_reason}

## 章节骨架 / 子论点（来自灵感的追问方向）
{skeleton_lines}

## 目标平台与体裁
目标平台：{platform_label}。请按该平台文体的常规结构与表达密度成稿。
{source_annotation}
{preference_section}
{summary_section}
## 成稿要求
- 忠于灵感字段给出的方向与子论点；可基于检索补充论据，但不得替换灵感的核心立场。
- 不得引入灵感之外的虚构人物、公司、数据或事件。
- 输出一份完整、可直接发布的稿子正文（Markdown）。
"""
