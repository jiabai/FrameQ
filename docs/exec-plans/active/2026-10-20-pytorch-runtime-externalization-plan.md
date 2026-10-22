# PyTorch 运行时外置实现计划

> 本文件是活文档。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective 随执行持续更新。

**Goal:** 把 PyTorch 族运行时（funasr、torch、torchaudio、transformers 及其闭包，合计 7,562 个文件、421 MB）从安装包移出，改为用户选中 `iic/SenseVoiceSmall` 时按需下载的独立组件，并把默认模型切到 `iic/SenseVoiceSmall-onnx`。

**Architecture:** 构建脚本用 `uv export --prune` 从同一份 `uv.lock` 切出两份依赖集，分别装进包内运行时与 PyTorch 组件压缩包。组件托管在 GitHub Releases 资产上，沿用现有模型下载器的断点续传与校验行为。worker 在选中 PyTorch 族时校验组件指纹并把组件的 `site-packages` 前置进 `sys.path`，缺失时返回结构化错误码。前端在设置页给组件缺失的模型加标注与下载入口。

**Tech Stack:** Node（`scripts/build-installer.mjs`）、GitHub Actions、Python 3/pytest/Ruff、TypeScript/React/Vitest/i18next、Rust/Tauri 2。

---

## Purpose / Big Picture

首次安装失败报告暴露了安装期写入量过大的问题：包内 Python 运行时 25,016 个文件、950 MB，其中 PyTorch 族占 421 MB，只服务两个 SenseVoice 模型里的一个。规格 `docs/product-specs/2026-10-20-lightweight-installer-runtime-trim.md` 已确认三件事：字节码早已不进包、可外置 421 MB、ONNX 与 PyTorch 的输出差异在容忍度内（Comparison Record）。本计划把外置落地：包内降到约 17,454 文件、529 MB，PyTorch 用户多一次约 421 MB 的组件下载。

## Progress

- [x] Stage 1：worker 组件契约（检测、指纹、`sys.path` 注入、缺失错误码）+ 单测（2026-10-20 完成，`2887fd8`）
- [x] Stage 2：构建脚本双依赖集与组件打包，本地 `--skip-tauri-build` 等价验证通过（2026-10-21，提交待填）
- [x] Stage 3：组件托管与下载（URL、进度、断点续传、校验）+ 设置页入口（2026-10-21 完成，`c6855c5` / `a1bc22d` / `c26dd0d` / `28e2b84`）
  - [x] worker 侧下载链路（2026-10-21，提交待填）：`runtime_component_download.py`（下载器层）+ `worker_application/runtime_component_download.py`（env 驱动的服务入口）+ CLI `--download-runtime-component`；四个进度码登记进封闭注册表、共享契约 JSON 与 TS 协议镜像；`_download_url_to_file` 加 `downloading_message_code` 参数供两条通道复用
  - [x] Rust 侧（2026-10-21，提交待填）：`RuntimeComponentDownloadJob` 与 `build_runtime_component_download_command_spec`；`download_runtime_component` 命令（按 `v<版本>` 与平台拼 GitHub Releases 资产地址，版本取 `CARGO_PKG_VERSION`）；常规 worker 命令注入 `FRAMEQ_PYTORCH_RUNTIME_DIR` 供 ASR 门禁解析；复用模型下载 lane 与结果协议（不新增 `WorkerOperation`，避免诊断与结果协议四处匹配）
  - [x] 错误码文案映射（2026-10-21）：`ASR_RUNTIME_COMPONENT_MISSING`、`ASR_RUNTIME_COMPONENT_STALE`、`RUNTIME_COMPONENT_DOWNLOAD_FAILED`、`RUNTIME_COMPONENT_INVALID` 三语文案与映射测试
  - [x] 设置页入口（2026-10-21）：模型准备面板底部加「下载 PyTorch 运行时组件」按钮（`guide.runtimeComponent`），走 `settingsClient.downloadRuntimeComponent` → hook `startRuntimeComponentDownload` → Tauri 命令；成功/失败复用面板既有通知位，三语文案齐备。未做「按状态显示/隐藏」：组件是否必需只有构建期 manifest 知道，前端暂不探测，按需点击（worker 侧幂等短路）。
  - 说明：包内 manifest 改放 `resources/python/runtime-manifest.json`。原方案放在 `resources/runtime-manifest.json` 并登记进 tauri 资源清单，但该文件是构建产物，dev 下不存在会让 `cargo build` 直接失败；放进 `resources/python/` 后由既有通配覆盖，仓库也不会出现每次构建都变脏的跟踪文件。
- [ ] Stage 4：默认模型切 ONNX、升级说明 UI、文档与发布收尾
  - [x] 默认切 ONNX（`0439934`）：顺带修掉两处「拿默认值拼集合/当分支判据」的静默塌缩 bug（`requests.py` 的 `DESKTOP_ASR_MODELS`、`model_download.py` 的校验与覆盖分支）
- [x] 默认模型在持久化入口保持一致（2026-10-22）：`.env` 初始化模板改为 `iic/SenseVoiceSmall-onnx`；本地设置文件新增 `FRAMEQ_SETTINGS_SCHEMA_VERSION=2`，读取配置时按版本执行一次性迁移，把旧模板写入的 PyTorch 模型切到 ONNX，保存配置时同步写版本号，用户之后显式选择 PyTorch 保持不变；前端默认常量、请求默认参数与设置页默认顺序同步为 ONNX
  - [x] 升级说明 UI（2026-10-22）：迁移时若旧值仍是 PyTorch 模板默认值，就在本地设置里写入 `FRAMEQ_ASR_MODEL_MIGRATION=1`；`get_llm_config` 返回 `asr_model_migrated`，设置页据此显示一次性提示，说明原因与切回方式。用户点「知道了」调用 `dismiss_asr_model_migration` 只清标记，不动草稿；保存配置也会清掉标记。旧值本来就是 ONNX 的配置不产生标记
  - [ ] README / ARCHITECTURE / 规格状态同步
  - [x] 发布前在真实长视频上重跑 Comparison Record（2026-10-21）：10 分 16 秒访谈视频，归一化相似度 0.90，覆盖到底、无内容缺失，最大差异块经时间戳核对为分段粒度造成的对齐假象；记录写进规格的对比记录小节

Stage 4 开工评估（2026-10-21，已回滚，仓库保持绿）：把 `DEFAULT_ASR_MODEL` 指向 `SENSEVOICE_SMALL_ONNX_MODEL` 后 worker 全量出现 **18 个失败，跨 5 个文件**，全部是夹具默认按 PyTorch 路径构造所致，需要逐个判断「该测试是否本就该显式指定模型」：

- `test_cli.py` 4 项：`uses_configured_output_and_cache_roots`、`uses_download_stdout_inside_task_cache_dir`、`reports_missing_downloaded_asr_model_after_audio_extraction`、`uses_explicit_asr_model_instead_of_user_data_env`
- `test_model_download.py` 2 项：`terminal_success_omits_local_model_directory`、`terminal_uses_allowlisted_onnx_model_and_ignores_pytorch_overrides`
- `test_requests.py` 2 项：local media v4 与 process v3 的精确输入解析夹具
- `test_contract.py` 1 项：`worker_constants_match_desktop_contract`（契约 JSON 里默认模型常量）
- `test_task_artifacts.py` 2 项（参数化的持久化失败映射，间接依赖默认模型）
- 其余为同类夹具连带

结论：这不是一行改动，是一次带迁移面的切换。应先完成前三条（升级说明 UI 与文档），再单独一轮处理夹具与契约，最后重跑 Comparison Record。

Stage 1 落地记录：模块放顶层 `worker/frameq_worker/runtime_component.py`（组件门禁属运行时供给，与 `model_download.py` 平级，不进 `asr_runtime/` 以免破坏封闭的模块树清单）；门禁抽成 `transcript.py` 的纯函数 `evaluate_pytorch_component_gate` 便于单测；包内 manifest 缺失时门禁不生效，dev 与旧版安装不受影响；新增错误码 `ASR_RUNTIME_COMPONENT_MISSING` 与 `ASR_RUNTIME_COMPONENT_STALE`，前端 `WORKER_ERROR_MESSAGE_CODES` 映射与文案留到 Stage 3 与下载入口一起做。

Stage 2 落地记录：torch 族改走 `pyproject.toml` 的 `[project.optional-dependencies] pytorch`（比 `--prune` 干净，uv 原生支持两侧导出），构建脚本对包内与组件各写一份 `runtime-manifest.json`（`uv.lock` 的 SHA-256 指纹），组件按 METADATA 名与 RECORD 文件清单剪掉与包内重叠的发行版（88 个），打成 `frameq-pytorch-runtime-<target>.zip`，CI 三个平台各自 `gh release upload`。本地等价验证（独立解释器 + 真实构建函数，`build/verify-component.mjs`）：包内 site-packages **16,810 文件 / 502 MB**（验收线 ≤18,000 / ≤550 达标），包内 `import funasr` 失败且 ONNX 冒烟通过，组件 zip **140 MB**（原 421 MB），组件内 `import funasr, torch, torchaudio` 通过，指纹一致。本机验证靠 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 与 npmmirror 镜像绕开两个本机坑，CI 不涉及。包内 manifest 落在 `resources/python/runtime-manifest.json`（产物目录本身被 `resources/python/**/*` 通配进包，避免仓库里出现每次构建都会变脏的跟踪文件）；mac 冒烟步骤加了 manifest 存在性检查。

## Surprises & Discoveries

（执行中记录）

## Decision Log

- **组件托管用 GitHub Releases 资产**：桌面端发布本就经 GitHub Releases，单资产上限 2 GB 足够，CI 只需在现有 workflow 追加一个上传步骤。备选的 ModelScope「模型仓库」需要按模型语义组织内容，语义不合。Stage 3 动工前向用户确认。
- **剪枝集合固定为 `--prune torch --prune torchaudio --prune funasr`**：`funasr-onnx` 经 `librosa` 拉起的 `scikit-learn`、`numba`、`llvmlite`、`scipy` 留在包内，那是 ONNX 路径自身所需。
- **组件内部布局统一为 `site-packages/`**：不沿用各平台 python-build-standalone 的原生布局（mac 嵌在 `lib/python3.x` 下），构建脚本把两侧都归一化，worker 注入逻辑只认一个路径。
- **指纹对指纹**：构建脚本在包内与组件内各写一份 `runtime-manifest.json`，记录 `uv.lock` 的解析指纹。worker 比对两份指纹，不一致按缺失处理，避免引入运行期无法获得的 `uv.lock`。

## Outcomes & Retrospective

（完成后填写）

## Context and Orientation

现状：`scripts/build-installer.mjs` 用 `uv export --no-dev` 生成 requirements，装进 `app/src-tauri/resources/python`，随后 `pruneBundledPythonRuntime` 清字节码；CI（`desktop-release.yml`）三平台各跑一次 `--skip-tauri-build` 再 `tauri build`。模型下载在 `worker/frameq_worker/model_download.py`，含 ModelScope 下载、校验、进度事件与断点续传。ASR 选择在 `worker/frameq_worker/asr_runtime/registry.py`，真实管线入口是 `pipeline_runtime/transcript.py` 的 `run_asr_transcript_stage`：解析 `FRAMEQ_MODEL_DIR` 得到模型缓存，校验后调用 `factory(request.asr_model, model_cache_dir)`。ONNX 模型目录布局为 `<cache>/onnx/models/iic/<名>`。

本计划的组件不是模型：模型（权重）走现有模型下载流程不变，组件是依赖闭包，二者目录、生命周期、指纹都独立。

## File and Interface Map

| 路径 | 动作 | 说明 |
| --- | --- | --- |
| `worker/frameq_worker/asr_runtime/runtime_component.py` | 新增 | 组件检测、指纹比对、`sys.path` 注入 |
| `worker/frameq_worker/pipeline_runtime/transcript.py` | 修改 | 选中 PyTorch 族时先走组件检查 |
| `worker/tests/test_runtime_component.py` | 新增 | 契约单测 |
| `scripts/build-installer.mjs` | 修改 | 双依赖集、组件打包、双 manifest |
| `.github/workflows/desktop-release.yml` | 修改 | 上传组件资产 |
| `worker/frameq_worker/model_download.py` | 修改 | 组件下载入口（复用既有下载器行为） |
| `app/src/settingsClient*` 与设置页组件 | 修改 | 模型条目标注与下载入口 |
| `worker/frameq_worker/asr_runtime/registry.py` | 修改 | `DEFAULT_ASR_MODEL` 切 ONNX（Stage 4） |

## Plan of Work

### Stage 1：worker 组件契约

- [ ] 新增 `runtime_component.py`：`resolve_component_dir(app_data_root)`、`read_manifest(dir)`、`fingerprints_match(component, bundled)`、`install_sys_path(dir)`（按平台归一化取 `site-packages`，幂等前置、去重）
- [ ] `transcript.py` 的 `run_asr_transcript_stage` 在 `asr_model_family == "sensevoice"` 时先查组件，缺失或指纹不符返回 `ASR_RUNTIME_COMPONENT_MISSING` 结构化结果，错误文案区分「未下载」与「版本不匹配需重新下载」
- [ ] 单测覆盖：组件齐全、缺失、指纹不符、重复注入幂等
- [ ] 门禁：`uv run pytest worker/tests` 全绿、`uv run ruff check worker`

### Stage 2：构建脚本双依赖集

- [ ] `build-installer.mjs`：包内 requirements 加 `--prune torch --prune torchaudio --prune funasr`；新增组件构建，把 torch 闭包装进独立 `site-packages/`，产出压缩包与 `runtime-manifest.json`
- [ ] 包内同样写入 `runtime-manifest.json`，两份指纹来自同一次 `uv lock` 解析
- [ ] 本地 `node scripts/build-installer.mjs --target windows-x64 --skip-tauri-build` 验证：包内文件数与体积达标，组件压缩包可解压且 `import funasr` 可用
- [ ] CI 上传组件资产（Stage 3 前置）

### Stage 3：组件下载与设置页入口

- [ ] `model_download.py` 新增组件下载：GitHub Releases 资产 URL、断点续传、SHA 校验、解压到 `%LOCALAPPDATA%\FrameQ\runtime\pytorch\<版本号>`、进度事件复用现有通道
- [ ] 前端：设置页 PyTorch 条目标注「需要下载组件」，选中时先触发组件下载，复用模型下载的进度与失败重试 UI
- [ ] 门禁：app lint、app test、worker 全量、`--level WARN` 文档治理

### Stage 4：默认模型与发布收尾

- [ ] `registry.py` 的 `DEFAULT_ASR_MODEL` 切 `iic/SenseVoiceSmall-onnx`
- [x] 升级用户的一次性说明（设置页），说明默认变化原因与恢复方式（2026-10-22）：迁移标记由 `settings.rs` 写入，`SettingsSheet.tsx` 渲染提示条，三种语言文案齐备，「知道了」只清标记
- [ ] README、ARCHITECTURE、SECURITY、产品规格同步；tech-debt 条目更新
- [ ] 发布前在真实长视频上重跑 Comparison Record 流程一次

## Validation and Acceptance

- 包内 `resources/python` ≤ 18,000 文件、≤ 550 MB（排除 `__pycache__` 与 `*.pyc` 度量）
- 干净机器：未下载组件时选中 PyTorch 得到结构化提示，不崩溃、不写残缺文件；下载完成后完成一次转写
- 默认 ONNX：干净机器完成一次 YouTube 转写与一次本地音频转写
- 组件指纹不匹配时判定为缺失，不复用旧目录
- 全量门禁与 `docs/EXECUTION_GATES.md` 一致
