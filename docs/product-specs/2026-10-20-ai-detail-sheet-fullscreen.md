# AI 详情弹层：全屏切换

## Background

`要点总结`、`文字稿解剖`、`启发灵感` 三个结果共用 `AiResultDetailSheet`，常规宽度上限 860px。长报告在这个宽度里需要反复滚动。`生成文字稿` 的结果弹层已经支持全屏，两者的阅读体验出现落差。

## Goals

- 三个 AI 详情 tab 都能在全屏与常规尺寸之间切换。
- 关闭弹层时退出全屏，下次打开从常规尺寸开始。
- 常规尺寸继续保持按内容收缩，短内容不撑满屏幕。

## Non-goals

- 不改 Markdown 渲染、导出与复制行为。
- 不改弹层的进出动画、背景点击关闭与 `Esc` 关闭。
- 不改常规尺寸下的宽度上限。

## Result Experience

- 按钮位于工具区「导出」之后，图标在 `Maximize2` 与 `Minimize2` 之间切换。
- 文案为「全屏」与「退出全屏」，通过 `aria-pressed` 暴露当前状态。
- 展开后宽度与高度取视口尺寸减 32px，由 `.ai-result-detail-sheet.is-expanded` 覆盖。

## Validation Rules

- 弹层在关闭动画期间仍然挂载，`expanded` 必须在 `detailOpen` 变为 false 时显式清除，不能依赖组件卸载。
- 切换全屏不改变当前 tab、内容、复制与导出的可用状态。

## Acceptance Criteria

- 三个 tab 下都能展开与收起。
- 关闭弹层再打开，回到常规尺寸。
- 展开后复制、导出、重新生成的入口保持可用。
