# 2026-10-24 Transcript Polish Execution Plan

Status: shipped in v0.4.3; native release smoke (real installer run, 整理→复制→重启恢复三态流转) still pending.

## Scope

结果工作区「整理文字稿」：`retry_insights` 新增 `transcript` target，worker 分段 LLM 修正 ASR 原稿，落盘 `transcript/polished.txt` + `polished.meta.json`，前端按钮双态切换。规格见 `docs/product-specs/2026-10-24-transcript-polish-action.md`。

## Batches (all complete)

1. **契约与解析层**：`contracts/desktop-worker-contract.json` contractVersion 8→9、target enum 补 `transcript`；`desktop_contract.py`、Rust `lib.rs` `DESKTOP_WORKER_CONTRACT_VERSION = 9`；`models.py` / `requests.py` target 白名单；`worker/tests/test_contract.py`、`app/src/desktopWorkerContract.test.ts`、`scripts/tests/build-installer.test.mjs` 断言同步。
2. **worker 步骤**：`worker/frameq_worker/transcript_polish.py`（路径硬校验、~2000 字分段、24 段上限、一次 checkout、`ProviderOpenAIOfficial.text_chat` 逐段修正、atomic 落盘）；`task_store.py` 新增 `transcript_polished_txt_path` / `transcript_polished_meta_path`；`worker_application/insight_retry.py` transcript 分支。
3. **worker 测试**：`worker/tests/test_transcript_polish.py`（路径校验、空稿、超长、空返回、原稿字节不变、事务恢复后整理稿仍在、进度事件）。`uv run pytest worker/tests` + `ruff check worker` 全绿。
4. **Rust 通道与读取**：`retry_insights.rs` `Transcript` 变体；`transcript_detail.rs` / `edit_storage.rs` 读 `polished.txt` 并按 meta SHA-256 判过期，输出 `polished_text: Option<String>`；Rust 单测。`cargo test` 全绿。
5. **前端协议与文案**：`desktopWorkerProtocol.ts` transcript variant（不进 `InsightRetryTarget`）；`transcriptDetailClient.ts` `polished_text` 可空校验；`transcriptResources.ts` / `errorResources.ts` 三语；`workerErrorCopy.ts` 五个 `POLISH_*` 码。
6. **前端控制器与 UI**：`useTranscriptPolishController.ts`（登录/额度拦截、忙碌态、失败提示）；`useTranscriptDocumentController.refreshPolishedTranscript`（只更新整理稿字段）；`useArtifactDetailController.copyTranscriptFile` 优先复制整理稿；`LocalTranscriptWorkspace.tsx` 按钮双态；`App.tsx` 装配。tsc + vitest 83 文件 859 测试全绿。
7. **文档**：ARCHITECTURE（v9、transcript polish boundary、目标清单）、DESIGN（复制按钮条款）、SECURITY（分段上限与 SHA-256 过期判定）、product spec 与本计划。

## Outstanding

- 真实安装包冒烟（整理→复制→重启恢复三态流转）。v0.4.3 发布时仍未在真实安装包里手工走一遍，已在 release notes 与 `TASKS.md` 台账中登记为残余风险。

## Outcomes & Retrospective

- 随 v0.4.3 发布（tag target `e80c8bd`）。发版门禁：worker 1162 passed / 3 skipped，Rust 354，前端 86 文件 866 项，server 401 passed / 1 skipped，scripts 52 项，ruff / lint / build / 文档治理全绿。
- 6 处版本文件 bump 与 `site/src/consts.ts` 的 `LATEST_VERSION` 同步由发版流程统一处理（参考 `topics/release-process.md`）。
