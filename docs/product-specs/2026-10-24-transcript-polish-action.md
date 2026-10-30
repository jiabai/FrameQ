# 结果工作区：整理文字稿

## Background

ASR 转写受口音、专有名词、同音字影响，正式稿里常有识别错误，且口语转写保留了大量语气词与无信息量重复，通读困难。结果工作区工具栏的「复制文字稿」只能原样复制 `transcript.txt`。用户希望先由 LLM 做一次适度整理（修正错误、去口头语、理顺分段），再复制一份更可读的文字稿。冒烟验证（2026-10-24）确认「仅修正识别错误」的保守档通读感无明显变化，故定档为中度整理。

## Goals

- 工具栏原「复制文字稿」按钮在无整理稿时显示为「整理文字稿」，位置与可见性规则不变（紧跟「定位文字稿」右侧）。
- 点击后直接开始整理（不弹确认框）：通过 `retry_insights` 的 `transcript` target 调用云端 LLM，做中度整理：修正 ASR 的错字、漏字、断句与标点，删除不影响原意的口头语与无意义重复，并按语义重新分段。
- 中度整理的红线：不改变原意，不增删事实内容，不把说话人的用词换成书面同义词，不润色升华，不翻译。
- 整理产物是独立文件 `transcript/polished.txt`，原有 `transcript.txt` 与 `segments.json` 一律不动。
- 整理成功后按钮变为「复制文字稿」，点击复制整理后的文字稿；重启或从历史恢复任务后该状态依然成立。
- 未登录或额度不足时先打开账号面板，不发起调用。

## Non-goals

- 不改动校对区底部「复制」按钮（仍复制编辑器草稿）与「定位文字稿」。
- 不新增整理稿预览抽屉或导出入口；整理稿只通过按钮复制。
- 不把整理稿回写 `transcript.txt`，不更新 manifest 的 `text`/`text_preview`，不登记进任务事务 artifact 白名单。
- 不在 AI 工作区增加第五张 target 卡片；`transcript` 不进入前端 `InsightRetryTarget` 联合类型。
- 整理失败不改变任务终态，不生成部分产物。

## Result Experience

- 无整理稿时按钮为「整理文字稿」（Sparkles 图标）；点击后进入忙碌态：图标转圈、文案变「整理中」、`aria-busy`、校对区编辑与保存禁用。
- 未登录或 AI 额度不足时，点击打开账号面板并显示既有 AI 拦截提示，不消耗额度。
- 整理成功提示 `transcript.notice.polishedReady`；失败提示 `transcript.notice.polishFailed`（带错误码）或 `polishFailedNoCode`。
- 有有效整理稿时按钮为「复制文字稿」（Copy 图标），点击复制整理稿正文；原稿仍可从校对区「复制」获得。
- 历史任务恢复、应用重启后，只要 `polished.txt` 有效即直接显示「复制文字稿」。

## Validation Rules

- worker 只读取通过路径硬校验（非软链/junction）的正式稿 `transcript.txt`；空稿报 `POLISH_EMPTY_TRANSCRIPT`。
- 分段修正：约 2000 字按句界切段，段间携带上一段末尾约 200 字衔接上下文；超过 24 段报 `POLISH_TRANSCRIPT_TOO_LONG`，不发起调用。
- LLM 凭据复用成稿链路：整次整理只做一次 server-managed checkout（消耗一次 AI Credits），分段调用不再单独计费；LLM 空返回报 `POLISH_LLM_EMPTY_RESULT`，异常报 `POLISH_FAILED`。
- 产物以原子替换写入 `transcript/polished.txt`，并在 `transcript/polished.meta.json`（schema v1）记录原稿 SHA-256；写盘失败报 `POLISH_ARTIFACT_WRITE_FAILED`。
- `load_transcript_detail` 仅在 `polished.txt` 存在、为普通文件、且 meta 里的原稿摘要与当前 `transcript.txt` 匹配时返回 `polished_text`；原稿被编辑后整理稿视为过期，按钮回到「整理文字稿」。正式稿保存成功后客户端立即重新读取详情并重判，按钮在同一次保存内完成切换，不需要重开任务。
- 整理期间不重置编辑器草稿；成功后只更新整理稿字段。

## Acceptance Criteria

- 完成态、无整理稿：工具栏依次为「定位视频」「定位音频」「定位文字稿」「整理文字稿」。
- 登录且有额度时点击「整理文字稿」：进入忙碌态，`polished.txt` 生成后按钮变为「复制文字稿」，此时点击剪贴板得到整理稿正文，且 `transcript.txt` 字节不变。
- 未登录时点击：打开账号面板，不产生 `polished.txt`。
- 超长文字稿点击：出现「文字稿过长」失败提示，不消耗额度。
- 整理成功后编辑原稿并保存：保存完成后按钮立即回到「整理文字稿」，无需重开任务或重启应用。
- 重启应用并恢复同一任务：按钮仍为「复制文字稿」，复制内容为整理稿。
