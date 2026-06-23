# FrameQ 一键安装对外发布方案

| 字段 | 值 |
|------|---|
| 状态 | Draft |
| 创建日期 | 2026-06-17 |
| 作者 | WorkBuddy |
| 关联文档 | `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/design-docs/core-beliefs.md` |
| 决策性质 | 改变用户可见安装体验、改变打包链路、触及核心信念 §5（权重分发策略） |

## 1. 目标与约束

### 1.1 用户期望

终端用户双击安装包 → 一路下一步 → 启动 FrameQ → 立即可用。**无需预装 Python、无需预装 uv、无需预装 ffmpeg、无需命令行操作。**

### 1.2 项目硬约束（不可绕过）

| 约束 | 来源 | 含义 |
|------|------|------|
| Local-first | `core-beliefs.md §1` | 视频/音频/文字稿默认本机处理；云端仅限话题点生成通过 server-managed LLM checkout 使用 |
| Worker owns heavy processing | `core-beliefs.md §2` | UI 不直接调 yt-dlp/ffmpeg/ASR/LLM |
| Runtime independence | `core-beliefs.md §3` | 不依赖 `D:\Github\InsightFlow\src\server` |
| Recoverable partial success | `core-beliefs.md §4` | 话题点失败不丢文字稿 |
| Observable progress | `core-beliefs.md §5` | 长耗时阶段必须有可见状态 |
| Secrets 不硬编码 | `SECURITY.md §Secrets` | LLM Key 不进入桌面安装包和本机 `.env`，只由 FrameQ server 管理员托管 |
| **权重不入安装包** | `AGENTS.md 核心信念` | **本方案需要重新审视，见 §3.4** |

### 1.3 当前架构的发布阻塞点

经代码审查，以下三点使当前 `tauri build` 产物**无法对外发布**：

1. **`app/src-tauri/tauri.conf.json` 的 `bundle` 段没有 `resources` 字段** —— worker 源码、Python 依赖、ffmpeg 全部未打包。
2. **`app/src-tauri/src/lib.rs:110` 硬编码 `Command::new("uv")`** —— 终端用户机器若未安装 uv，worker 启动即失败。
3. **`app/src-tauri/src/lib.rs:351-361` 的 `find_project_root()` 通过 cwd 祖先查找 `pyproject.toml`+`worker/`** —— 装到 `C:\Program Files\FrameQ\` 后该函数返回 `None`，应用报错 `"Could not find FrameQ project root"`。

## 2. 方案总览：全量内嵌（Maximal Embedding）

**策略：把整个运行时栈——Python 解释器、所有 Python 依赖、ffmpeg/ffprobe、worker 源码——全部塞进安装包。终端用户机器零依赖。**

### 2.1 安装包内容物清单

```
FrameQ-Setup-x.y.z.exe  (约 1.5–2.5 GB)
├── FrameQ.exe                          # Rust+Tauri 编译产物（壳）
├── resources/
│   ├── python/                         # python-build-standalone 独立解释器
│   │   ├── python.exe
│   │   ├── python311.dll
│   │   ├── Lib/                        # 标准库
│   │   └── site-packages/              # 预装依赖：modelscope, qwen-asr, yt-dlp, torch, ...
│   ├── worker/                         # frameq_worker 源码（含 insightflow/）
│   ├── pyproject.toml                  # 仅作为元数据，运行期不再 pip install
│   ├── bin/
│   │   ├── ffmpeg.exe                  # 内嵌 ffmpeg
│   │   └── ffprobe.exe                 # 内嵌 ffprobe
│   └── .env.template                   # 配置模板
└── (WebView2 Runtime 由 NSIS/Tauri 自动引导安装)
```

**体积估算**：

| 组成 | 体积 | 说明 |
|------|------|------|
| Rust 壳 + Tauri 运行时 | ~10 MB | |
| python-build-standalone | ~30 MB | 独立 Python 3.11 |
| 预装 site-packages | ~1.2 GB | 主要来自 torch CPU、modelscope、qwen-asr、funasr 等大依赖 |
| ffmpeg/ffprobe | ~80 MB | |
| worker 源码 | <1 MB | |
| **小计（不含 ASR 模型）** | **~1.3 GB** | |
| Qwen3-ASR-0.6B 权重 | ~1.8 GB | 见 §3.4 决策 |
| **若模型入包总计** | **~3.1 GB** | |

### 2.2 运行期调用链（重写后）

```
用户启动 FrameQ.exe
  → Tauri runtime
  → Rust 壳 invoke_handler
  → process_video / retry_insights 命令
  → Command::new(<resource_dir>/python/python.exe)
      .args(["-m", "frameq_worker", "--request-json", ...])
      .env("PYTHONPATH", <resource_dir>/worker)
      .env("PATH", <resource_dir>/bin + 系统 PATH)   # 让 worker 能调 ffmpeg/ffprobe
      .env("PYTHONUTF8", "1")
      .env("PYTHONIOENCODING", "utf-8")
      .env("FRAMEQ_MODEL_DIR", <用户数据目录>/models)  # 见 §3.4
      .env("FRAMEQ_RESOURCE_DIR", <resource_dir>)
      .current_dir(<用户数据目录>)                      # outputs/ work/ 写到用户目录
  → worker 输出结构化 JSON 到 stdout
  → Rust 解析 → emit 给前端
```

## 3. 关键技术决策

### 3.1 Python 解释器：python-build-standalone

**选型理由**：indygreg 的 [python-build-standalone](https://github.com/indygreg/python-build-standalone) 提供**单 zip 解压即用**的 CPython 发行版，无外部依赖、无注册表写入、可重定位，是 PyOxidizer/uv 等工具的底层选择。

**集成方式**：
- 构建脚本下载 `cpython-3.11.x-x86_64-pc-windows-msvc-install_only.zip`
- 解压到 `app/src-tauri/resources/python/`
- 通过 `tauri.conf.json` 的 `bundle.resources` 字段一并打包

**为何不选 PyInstaller**：qwen-asr / modelscope 依赖含原生扩展（torch、numpy BLAS），PyInstaller hidden-imports 调试成本高，且单文件 exe 启动慢。python-build-standalone 直接复用标准 import 机制，零适配。

**为何不选 uv 内嵌**：uv 仍需在用户机器执行 `uv sync`，触网下载依赖，违背"无脑即用"。本方案在**构建期**就完成依赖安装，运行期不再触网。

### 3.2 Python 依赖：构建期预装到 site-packages

**流程**：
1. 在构建机（CI 或本地）创建临时 venv：`python -m venv build-venv`
2. `build-venv\Scripts\pip install -r requirements.txt`（从 `pyproject.toml` 导出）
3. 把 `build-venv\Lib\site-packages\` 整个复制到 `resources\python\Lib\site-packages\`
4. 确认 `modelscope`、`qwen_asr`、`yt_dlp`、`torch`、`numpy` 等关键模块可被 `resources\python\python.exe -c "import modelscope"` 导入

**requirements.txt 生成**：在 `pyproject.toml` 中追加 `[project.optional-dependencies] bundle = [...]`，列出 modelscope 等运行期依赖；构建脚本用 `uv export --no-dev` 产出锁定版本。

**风险**：torch CPU 版约 800MB，是体积大头。如未来需精简，可改用 `torch+cpu` 索引并启用 `--no-deps` 手动挑选。本方案优先省心，暂不优化。

### 3.3 ffmpeg/ffprobe：内嵌二进制

**来源**：[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 的 `ffmpeg-release-essentials.zip`，取 `bin/ffmpeg.exe` 和 `bin/ffprobe.exe`。

**集成方式**：
- 构建脚本下载并解压到 `app/src-tauri/resources/bin/`
- Rust 侧在 spawn worker 时通过 `env("PATH", ...)` 把 `resources/bin` 前置到 PATH
- worker 内部 `shutil.which("ffprobe")` 即可命中，无需改动 worker 代码

**为何不打包完整 ffmpeg**：essentials 已含所有 FrameQ 需要的编解码器（AAC、MP3、WAV、Opus）。full shared 版本会引入额外 200MB+，无收益。

### 3.4 ASR 模型分发：核心信念冲突与决策

#### 冲突点

`AGENTS.md` 核心信念明确写"大模型权重不打进安装包"。但用户本次要求"无脑安装即用、不考虑体积"。两者在 ASR 模型这一项上直接冲突。

#### 三个候选方案

| 方案 | 安装包体积 | 首启动体验 | 是否违背核心信念 | 适用场景 |
|------|-----------|-----------|----------------|---------|
| **A. 模型不入包，首启动下载** | ~1.3 GB | 首次使用 ASR 时下载 1.8GB，需联网 5–15 分钟 | 否 | 严格遵守当前治理 |
| **B. 模型直接入包** | ~3.1 GB | 双击即用，完全离线 | **是**，需更新 `AGENTS.md` 与 `core-beliefs.md` | 用户明确要"无脑即用" |
| **C. 混合：安装包内置 + 联网校验更新** | ~3.1 GB | 即用 + 后台校验模型版本 | **是**，同方案 B | 平衡离线可用与版本新鲜度 |

#### 推荐方案

**推荐方案 B**，理由：
- 用户明确表达"不考虑体积，只要最省心"
- Qwen3-ASR-0.6B 是 FrameQ 唯一模型，版本稳定，无频繁更新需求
- 首启动下载 1.8GB 在中国大陆网络环境体验差（modelscope CDN 不稳），违背"无脑即用"初衷
- 3.1GB 安装包在 2026 年的带宽环境下可接受（一次下载，永久离线可用）

**前提条件**：实施前必须先更新 `AGENTS.md` 和 `docs/design-docs/core-beliefs.md`，把"权重不入安装包"修订为"**权重可入安装包，但必须满足：① 仅限 Qwen3-ASR 等核心模型；② LLM 仍按需配置不入包；③ 模型版本在 `models/MODEL_VERSION.txt` 中显式记录**"。这是治理流程要求，不可跳过。

#### 模型路径处理

- 构建期：把 `models/models--Qwen--Qwen3-ASR-0.6B/` 复制到 `resources/models/`
- 运行期：Rust 侧设置 `FRAMEQ_MODEL_DIR=<resource_dir>/models`
- worker `asr.py:50-58` 的 `resolve_model_cache_dir()` 无需改动，自动读取环境变量

### 3.5 LLM 配置：server-managed checkout

LLM API Key 属于"密钥不得硬编码"约束，不能入包，也不再由桌面端 `.env` 保存。话题点生成依赖管理员在 FrameQ server Admin Web 中配置的专用客户端 LLM key。

**方案**：首启动只检测本机 ASR 模型和非 LLM 本地设置；话题点功能根据账号状态中的 `llm_configured`、月卡和额度门禁决定是否可用：
- LLM 未由管理员配置 → 文字稿功能正常，话题点入口提示等待管理员配置
- LLM 已配置且用户有额度 → 二次确认后通过 server-managed checkout 注入 `FRAMEQ_LLM_SOURCE=server` 等临时环境变量

**用户数据目录定位**（Windows）：`%LOCALAPPDATA%\FrameQ\`，即 `C:\Users\<user>\AppData\Local\FrameQ\`。Rust 侧用 `dirs::data_local_dir()` 解析。

### 3.6 outputs/ 与 work/ 落地位置

安装到 `C:\Program Files\FrameQ\` 后，该目录普通用户无写权限。必须把 `outputs/` 和 `work/` 重定向到用户数据目录：

- `<LOCALAPPDATA>\FrameQ\outputs\`
- `<LOCALAPPDATA>\FrameQ\work\`

Rust 侧 `process_video` 命令通过环境变量 `FRAMEQ_OUTPUT_DIR` 和 `FRAMEQ_WORK_DIR` 传给 worker；worker 侧 `pipeline.py` 需读取这两个变量（小改动）。

## 4. 实施步骤

### 阶段 1：治理前置（必须先做）

1. 更新 `docs/design-docs/core-beliefs.md`：修订权重分发信念（见 §3.4）
2. 更新 `AGENTS.md`：同步核心信念条目
3. 在 `docs/product-specs/` 创建 `2026-06-17-installer-distribution-spec.md`，描述用户可见安装体验
4. 在 `docs/exec-plans/active/` 创建 `2026-06-17-installer-distribution-plan.md`，列出 ExecPlan

### 阶段 2：构建脚本

新增 `scripts/build-installer.ps1`（PowerShell，避免 .ps1 中文编码问题则全部用英文注释）：

```powershell
# 1. 下载 python-build-standalone
# 2. 下载 ffmpeg essentials
# 3. 创建 build-venv 并 pip install 依赖
# 4. 复制 site-packages 到 resources/python/Lib/site-packages
# 5. 复制 worker/ 到 resources/worker/
# 6. 复制 models/ 到 resources/models/
# 7. 复制 pyproject.toml 到 resources/
# 8. 执行 npm --prefix app run tauri build
```

### 阶段 3：Rust 侧改造

修改 `app/src-tauri/src/lib.rs`：

1. 删除 `find_project_root()` 和 `is_project_root()`
2. 新增 `resolve_resource_dir(app: &tauri::AppHandle) -> PathBuf`，基于 `app.path().resource_dir()`
3. 新增 `resolve_user_data_dir() -> PathBuf`，基于 `dirs::data_local_dir().join("FrameQ")`
4. 重写 `process_video` 和 `retry_insights`：
   - `Command::new(resource_dir.join("python/python.exe"))`
   - 设置 `PYTHONPATH`、`PATH`（前置 `resources/bin`）、`FRAMEQ_MODEL_DIR`、`FRAMEQ_OUTPUT_DIR`、`FRAMEQ_WORK_DIR`、`FRAMEQ_RESOURCE_DIR`
   - `current_dir(user_data_dir)`
5. 新增首启动向导命令 `check_first_run()` 和本机设置保存命令 `save_llm_config(config)`；该命令只保存 ASR 与输出目录设置，并移除旧 LLM 字段
6. `Cargo.toml` 添加 `dirs = "5"`

### 阶段 4：worker 侧适配

修改 `worker/frameq_worker/pipeline.py`：

1. `outputs/` 目录从 `FRAMEQ_OUTPUT_DIR` 环境变量读取，回退到 `project_root / "outputs"`
2. `work/` 目录从 `FRAMEQ_WORK_DIR` 环境变量读取，回退到 `project_root / "work"`
3. `config.py` 的 `load_project_env()` 支持从 `FRAMEQ_USER_DATA_DIR` 读取 `.env`（优先级：进程环境变量 > 用户数据目录 `.env`）；项目根 `.env` 不参与 runtime，旧 `FRAMEQ_LLM_*` dotenv 字段必须忽略

### 阶段 5：tauri.conf.json 改造

```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "resources": [
      "resources/python/**/*",
      "resources/worker/**/*",
      "resources/bin/**/*",
      "resources/models/**/*",
      "resources/pyproject.toml",
      "resources/.env.template"
    ],
    "icon": [...]
  }
}
```

### 阶段 6：前端首启动向导

新增 `app/src/FirstRunWizard.tsx`：
- 检测 `check_first_run()` 返回 true 时显示
- 引导用户下载/确认本机 ASR 模型，并展示可稍后在设置中调整的本机配置
- 提供"稍后下载"按钮
- 本机设置保存到 `%LOCALAPPDATA%\FrameQ\.env`；该文件只承载 ASR、输出目录和模型下载覆盖项，不保存 LLM key

### 阶段 7：验证

1. **干净 VM 验证**（关键）：在未装 Python、未装 uv、未装 ffmpeg 的 Windows VM 上双击安装包，验证：
   - 安装成功
   - 启动后首启动向导出现
   - 管理员在 server 配置 LLM 且账号额度可用后能完成完整链路（输入 URL → 下载 → 转译 → 话题点）
   - server 端 LLM 未就绪或账号额度不可用时文字稿功能正常，话题点降级提示
2. **离线验证**：拔网线后启动，验证已下载模型可用
3. **卸载验证**：通过控制面板卸载，确认 `C:\Program Files\FrameQ\` 清理干净，`%LOCALAPPDATA%\FrameQ\` 保留用户数据

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| python-build-standalone 与 modelscope 原生扩展兼容性问题 | 中 | 高 | 构建期 `python.exe -c "import modelscope, qwen_asr, torch"` 冒烟测试；保留 PyInstaller 作为 fallback |
| torch CPU 版在部分老旧 CPU 上因 AVX 指令缺失崩溃 | 低 | 高 | 在 README 注明最低 CPU 要求；或改用 torch CPU 通用版（牺牲性能） |
| 安装包过大导致部分用户下载失败 | 中 | 中 | 提供 GitHub Release + 国内镜像（如 Gitee、腾讯 COS）双链路 |
| modelscope 在运行期尝试联网校验版本导致卡顿 | 中 | 低 | 设置 `MODELSCOPE_OFFLINE=1` 环境变量强制离线 |
| WebView2 Runtime 缺失（Win10 早期版本） | 低 | 高 | NSIS 模板加入 WebView2 bootstrapper 链式安装 |
| 杀软误报（大体积 exe + 内嵌 Python） | 中 | 中 | 申请数字签名证书（EV Code Signing）；在 README 提供 SHA256 校验 |

## 6. 体积优化（可选，未来迭代）

本方案优先省心，不优化体积。如未来需要精简：

1. 用 `torch+cpu` 替换默认 torch：节省 ~200MB
2. 删除 site-packages 中的 `tests/`、`__pycache__/`、`.dist-info/`：节省 ~100MB
3. 用 UPX 压缩 python.dll 和 ffmpeg.exe：节省 ~50MB
4. 模型量化：Qwen3-ASR-0.6B → 0.3B INT8：节省 ~1GB（需验证精度）

## 7. 不在本方案范围内

- macOS / Linux 安装包（当前仅 Windows）
- 自动更新（Tauri Updater 配置，留作后续）
- 多语言安装界面
- LLM 模型本地化（仍依赖云端 API）

## 8. 决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-06-17 | 选择 python-build-standalone 而非 PyInstaller | 原生扩展兼容性更好，调试成本低 |
| 2026-06-17 | 选择方案 B（模型入包）而非方案 A | 用户明确要求无脑即用；首启动下载体验差 |
| 2026-06-17 | outputs/work 重定向到 LOCALAPPDATA | Program Files 无写权限 |
| 2026-06-17 | ffmpeg 选 essentials 而非 full | 体积与功能平衡 |

## 9. 下一步

待用户确认本方案后，进入 Plan 模式产出 ExecPlan，按阶段 1→7 顺序实施。建议先做阶段 1（治理前置）和阶段 2（构建脚本冒烟），验证 python-build-standalone + modelscope 链路可行后再推进 Rust 改造。
