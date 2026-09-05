# Xiaohongshu Numeric Subtitle Format Implementation Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

让已有小红书字幕优先流程识别平台实际返回的数字格式枚举，直接使用可用字幕生成文字稿。下载、安全校验与 ASR 兜底边界保持现有行为。

## Progress

- [x] 2026-08-25: 完成数字枚举兼容实现与回归测试并提交代码。Validation: `5001931` 包含字幕解析器与测试变更；原执行记录为 focused subtitle 25 passed、相关模块 104 passed、Ruff passed。
- [x] 2026-09-05: 使用现有下载和解析函数复验用户提供的视频链接，无需 ASR。Validation: 得到 262 条 `en-US` 字幕，结束时间 684620 ms；SRT 与此前直接下载文件逐字节一致，未加载 ASR 模型库。
- [x] 2026-09-05: 复验字幕下载、解析及媒体集成回归。Validation: 下文五个测试文件共 124 passed；测试缓存权限产生一条警告。
- [x] 2026-09-05: 按项目目录规范归档设计与完成计划并登记索引。Validation: 归档路径、索引、必需章节和旧目录移除检查通过；`validate_agents_docs.py --level ERROR` 与 `--level WARN` 均为 0 错误、0 警告；`git diff --check` 通过。

## Surprises & Discoveries

Evidence: `worker/frameq_worker/xiaohongshu/subtitles.py` 的格式字段既支持字符串，也需要兼容平台返回的精确整数 `0`；布尔值和其他数字不能按该枚举接受。

Evidence: 2026-09-05 真实链接的 `source` 轨语言为 `en-US`，原声轨不一定是中文；中文回归样例仅用于验证解析行为。

Evidence: 默认 pytest 临时目录受当前环境权限限制，使用工作区内独立 `--basetemp` 后 124 项全部通过。

## Decision Log

- Decision: 仅允许精确整数 `0` 回落到已有 URL 后缀判断。Rationale: 兼容真实元数据，同时保留未知格式的拒绝行为。Date/Author: 2026-08-25 / Codex（据原设计及提交记录归档）。
- Decision: 将设计放入 `docs/design-docs/`，完成计划放入 `docs/exec-plans/completed/`，不保留技能专用文档目录。Rationale: 遵循项目文档治理与用户明确要求。Date/Author: 2026-09-05 / User + Codex。

## Outcomes & Retrospective

实现与测试已纳入 `5001931`；本次仅整理文档。原实施记录的 104 项测试及实链下载见下文，2026-09-05 扩大到五个相关测试文件后 124 passed，并确认现有函数能独立抓取英文字幕。

Residual risk: 本次未运行完整桌面任务或发布安装包；平台字幕可用性取决于公开页面与 CDN。现有桌面流程仍先下载视频并提取音频，再通过字幕跳过 ASR。

## Context and Orientation

- Design: [数字格式枚举兼容设计](../../design-docs/2026-08-25-xiaohongshu-format-enum-design.md)。
- Worker: `worker/frameq_worker/xiaohongshu/subtitles.py`、`worker/frameq_worker/xiaohongshu_fallback.py`。
- Tests: `worker/tests/test_xiaohongshu_subtitles.py`。
- Related completed plan: [小红书平台字幕优先流程](2026-08-25-xiaohongshu-platform-subtitle-first-transcript-plan.md)。

## Validation and Acceptance

```powershell
.venv\Scripts\python.exe -m pytest worker/tests/test_xiaohongshu_subtitles.py worker/tests/test_xiaohongshu_fallback.py worker/tests/test_media.py worker/tests/test_media_preparation.py worker/tests/test_subtitles.py -q --basetemp outputs/pytest-xhs-format-enum-verification
python scripts/validate_agents_docs.py --level ERROR
python scripts/validate_agents_docs.py --level WARN
```

手工验收：用 `download_xiaohongshu_subtitle()` 下载公开链接字幕，再用 `find_subtitle_transcript()` 验证语言、非空文本与时间段；无需启动 ASR。

## Plan of Work

以下保留原实施任务与当时的验证记录。

**Goal:** Accept Xiaohongshu's numeric `format: 0` SRT metadata so the existing subtitle downloader selects and downloads the platform source track.

**Architecture:** Keep the change local to the subtitle track suffix parser. String formats retain their explicit validation; numeric zero falls through to the already existing URL-suffix inference, while unknown numeric values remain rejected. A regression test exercises the public selector seam with the live response shape.

**Tech Stack:** Python 3.12, pytest, Ruff.

---

### Task 1: Add the failing regression test

**Files:**
- Modify: `worker/tests/test_xiaohongshu_subtitles.py`

- [x] Add a test with `format: 0` and an `.srt` URL:

```python
def test_selects_platform_numeric_srt_format() -> None:
    note = note_with_groups(
        {
            "source": [
                {
                    "language": "zh-CN",
                    "url": "https://sns-subtitle-s1.xhscdn.com/source.srt?sign=redacted",
                    "format": 0,
                }
            ]
        }
    )

    assert select_preferred_subtitle_track(note) == XiaohongshuSubtitleTrack(
        language="zh-CN",
        url="https://sns-subtitle-s1.xhscdn.com/source.srt?sign=redacted",
        suffix=".srt",
    )
```

- [x] Run the focused test before implementation; it failed only for the new numeric-format case.

### Task 2: Implement the minimal numeric-enum fallback

**Files:**
- Modify: `worker/frameq_worker/xiaohongshu/subtitles.py:65-75`

- [x] Keep string `srt` / `vtt` validation unchanged.
- [x] Allow only the exact integer enum `0` to fall through to URL suffix inference; reject other non-string values.
- [x] Run the focused subtitle test; 25 tests pass.

### Task 3: Verify the integration and live path

**Files:**
- No additional source changes.

- [x] Run `pytest` for `test_xiaohongshu_subtitles.py`, `test_xiaohongshu_fallback.py`, and `test_media.py`; 104 tests pass with a writable pytest temp directory.
- [x] Run Ruff on the changed source and test files; all checks pass with a writable cache directory.
- [x] Run the real `download_xiaohongshu_subtitle()` path once with the supplied note; it produced a nonempty 32,721-byte `.srt`.
- [x] Confirm `git status` contains the intended Python/test/docs changes plus the two pre-existing Rust edits.
