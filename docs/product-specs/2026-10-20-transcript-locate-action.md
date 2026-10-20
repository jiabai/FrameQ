# 结果工作区：定位文字稿

## Background

完成态的结果页有一个本地文件工具栏，已经提供「定位视频」与「定位音频」。文字稿在左侧工作区直接可读，但要定位它的文件，只能绕到详情视图里操作。用户在结果页看到文字稿卡片时，缺一个和视频、音频并列的入口。

## Goals

- 在文字稿工作区的工具栏增加「定位文字稿」，顺序排在「定位音频」之后。
- 文字稿未生成时不显示该按钮，与视频、音频的可见性规则一致。
- 存在未保存的编辑时拦截定位，提示先保存。

## Non-goals

- 不改 `transcript.txt` 的产物路径、写入方式与原子替换语义。
- 不改详情视图里已有的定位入口，两个入口指向同一份文件。
- 不新增导出格式，不改变 Markdown 与纯文本的产出。

## Result Experience

- 按钮图标为 `FileText`，文案走 `workspace.locateTranscript`，三语与视频、音频保持同样的措辞风格。
- 点击后调用 `exportTranscript`，在系统文件管理器中选中当前任务的 `transcript.txt`。
- 工具栏在有任一可见动作时出现，避免出现空容器。

## Validation Rules

- 定位动作复用 `useArtifactDetailController.exportTranscript`，其中的未保存判定位于 `useArtifactDetailController.ts` 的 dirty 分支，提示文案为 `transcript.notice.unsavedLocate`。
- 不经过 `locateArtifact`。那条路径没有 dirty 拦截，会把磁盘上的旧稿定位给用户。

## Acceptance Criteria

- 完成态的文字稿工具栏依次包含「定位视频」「定位音频」「定位文字稿」。
- 点击「定位文字稿」打开文件管理器并选中 `transcript.txt`。
- 有未保存编辑时点击，出现保存提示，不发生定位。
- 文字稿尚未生成时，按钮不出现。
