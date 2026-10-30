# 结果工作区：复制文字稿

## Background

完成态的结果页有一个本地文件工具栏，已经提供「定位视频」「定位音频」「定位文字稿」。文字稿校对区底部的「复制」按钮复制的是编辑器里的当前文本，包含尚未保存的修改。用户需要在别处粘贴一份与磁盘上 `transcript.txt` 完全一致的内容时，编辑器草稿无法满足。

## Goals

- 在文字稿工作区的工具栏增加「复制文字稿」，位置紧接在「定位文字稿」右侧。
- 点击后把当前任务 `transcript.txt` 的正文写入剪贴板。
- 文字稿未生成时不显示该按钮，与视频、音频、文字稿定位的可见性规则一致。

## Non-goals

- 不改变校对区底部「复制」按钮复制编辑器草稿的行为。
- 不改变 `transcript.txt` 的产物路径、写入方式与原子替换语义。
- 不新增导出格式，不改变 Markdown 与纯文本的产出。
- 不因存在未保存的编辑而拦截复制。

## Result Experience

- 按钮图标为 `Copy`，文案走 `workspace.copyTranscript`，三语与相邻按钮保持同样的措辞风格。
- 点击后把文档控制器已加载的 `transcript.txt` 正文写入剪贴板。
- 复制成功提示 `transcript.notice.copied`。
- 剪贴板写入失败时提示 `transcript.notice.transcriptCopyFailed`。
- 正文无法读取时提示 `transcript.notice.transcriptFileCopyFailed`，剪贴板内容保持不变。
- 正文尚未加载完成时按钮置灰，避免读到空内容。
- 工具栏在有任一可见动作时出现，四个按钮按「定位视频」「定位音频」「定位文字稿」「复制文字稿」排列。

## Validation Rules

- 复制内容取自 `useTranscriptDocumentController` 持有的 `transcriptDetail.text`，该值是 `load_transcript_detail` 返回的正式稿正文。`transcriptDraft` 不参与。
- `useArtifactDetailController` 只负责写入剪贴板与提示，不读取文件，保持文字稿详情加载由文档控制器独占。
- 失败提示不带出文件路径与底层异常文本。
- 未保存编辑不构成拦截条件，复制结果始终是磁盘上的正式稿。

## Acceptance Criteria

- 完成态的文字稿工具栏依次包含「定位视频」「定位音频」「定位文字稿」「复制文字稿」。
- 编辑器里存在未保存修改时点击「复制文字稿」，剪贴板得到的是 `transcript.txt` 的内容，未保存的修改不出现在剪贴板中。
- `transcript.txt` 无法读取时点击，出现失败提示，不写入剪贴板。
- 文字稿尚未生成时，按钮不出现。

## 2026-10-30 修订：底部「复制」改名为「复制当前内容」

工具栏的「复制文字稿」与校对区底部的「复制」并排出现后，两个名字都叫“复制”容易让用户以为是同一件事。底部按钮复制的是编辑器当前文本（含未保存修改），与磁盘上的正式稿无关，因此改名为「复制当前内容」（繁体「複製目前內容」，英文 `Copy Current Text`），文案键仍为 `review.copy`，行为不变。
