# 小红书字幕数字格式枚举兼容设计

## 目标

让 FrameQ 识别小红书真实页面返回的 `format: 0` SRT 字幕轨道，并保持未知格式的安全拒绝行为。

## 方案

`worker/frameq_worker/xiaohongshu/subtitles.py` 保留字符串 `srt` / `vtt` 的显式格式解析；当平台返回整数枚举 `0` 时，不把它当作错误，而是继续使用字幕 URL 的后缀推断格式。真实平台 URL 以 `.srt` 结尾时可识别为 SRT，并按现有优先级选择 `source` 原声轨；语言以轨道的 `language` 字段为准，不固定为中文。其他整数或非字符串值仍然拒绝。

## 测试

在现有字幕选择器公共接口 `select_preferred_subtitle_track()` 上增加一个真实结构回归用例：`source` 轨带 `format: 0` 时必须返回 `zh-CN` 与 `.srt`。现有字符串格式和非法格式用例继续保留。

## 非目标

- 不修改签名 URL、页面请求、CDN 安全校验或 ASR 逻辑。
- 不改变字幕优先级或文件命名策略。

## 实现与验证

- 代码与回归测试已提交于 `5001931`。
- [完成计划](../exec-plans/completed/2026-08-25-xiaohongshu-format-enum-plan.md)记录实施结果、验证与残余风险。
