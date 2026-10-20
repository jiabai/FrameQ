# 安装包瘦身：默认切 ONNX 与 PyTorch 运行时外置

## Background

2026-10-20 的首次安装失败报告把安装阶段的写入量摆到了台面上：`resources/python` 是包内最大的一块，安装器顺序解压，安全软件有十几分钟窗口可以拦截。

实测分布（`app/src-tauri/resources/python`，排除 `__pycache__` 与 `*.pyc`）：

| 项 | 文件数 | 体积 |
| --- | --- | --- |
| CI 实际分发 | 25,016 | 950 MB |
| torch | 2,201 | 320 MB |
| transformers | 2,238 | 50 MB |
| sympy | 888 | 17 MB |
| funasr（PyTorch 版） | 426 | 4 MB |
| 其余 torch 闭包 | 1,809 | 30 MB |
| llvmlite | 31 | 102 MB |
| scipy | 856 | 70 MB |
| onnxruntime | 318 | 39 MB |
| jieba | 54 | 36 MB |
| scikit-learn | 578 | 20 MB |
| numba | 356 | 6 MB |

**字节码不在这张表里，也不在包里。** `scripts/build-installer.mjs` 已经在两处清掉它：`pruneBundledPythonRuntime`（`*.pyc`、`*.pyo`、`__pycache__`）与冒烟测试之后的 `removePythonCaches`。本机目录下那 11,526 个 `.pyc` 是本地跑 dev 时 Python 重新生成的，不是包内容，也不进 CI 产物。

torch 这一整套只服务 PyTorch 族的 `iic/SenseVoiceSmall`，而默认模型恰好是 PyTorch 版，于是它变成必需项。用 `uv export --prune torch --prune torchaudio --prune funasr` 可以从同一份 `uv.lock` 切出「不含 PyTorch 族」的依赖集，实测可外置 7,562 个文件、421 MB。

## Goals

- 默认模型从 `iic/SenseVoiceSmall` 切到 `iic/SenseVoiceSmall-onnx`。
- PyTorch 族的运行时（torch、torchaudio、funasr 及其闭包，含 transformers、sympy、tokenizers、safetensors、huggingface-hub、hydra-core、omegaconf、oss2、aliyun-sdk 等）移出安装包，改为用户选中对应模型时下载的独立组件。
- 安装后 `resources/python` 的文件数降到 18,000 以内，体积降到 550 MB 以内。

两个 SenseVoice 模型仍然可选，功能不减。

## Non-goals

- 不改 ONNX 运行时的依赖组成。`funasr-onnx` 会拉起 `librosa`，`librosa` 又带出 `scikit-learn`、`numba`、`llvmlite`、`scipy`，这条链合计约 234 MB 属于 ONNX 路径自身所需，本次不动，因此 400 MB 这个量级达不到。
- 不改模型文件的缓存位置、下载通道与进度事件。
- 不改 `installMode`、默认安装目录，以及已经提交的 NSIS 钩子。
- 不动 `tcl`、`pip` 与站点包里的测试目录，它们体积有限，留待单独评估。
- 不动 `.pyc` 处理，构建脚本已经清干净了。

## Runtime Component

PyTorch 族所需的运行时单独打包，内容由构建脚本用 `uv export --no-dev --prune torch --prune torchaudio --prune funasr` 从 `uv.lock` 生成，与包内依赖集同源。

- 存放：`%LOCALAPPDATA%\FrameQ\runtime\pytorch\<版本号>\`。
- 触发：用户在设置页选中 `iic/SenseVoiceSmall` 且本机缺少该组件时，界面提示需要下载，用户确认后开始。
- 注入：worker 仅在选中 PyTorch 族时把该目录加入 `PYTHONPATH`，ONNX 路径不受影响。
- 版本：组件内写入清单文件，记录 `uv.lock` 的解析指纹。指纹与当前 worker 不一致时按缺失处理，重新下载。
- 失败：下载或校验失败时不改动已有文件，界面提供重试，不消耗 AI 额度。

Linux 专属的 `nvidia-*`、`cuda-*`、`triton` 会被同一个 `--prune` 一并剪掉，不需要单独处理。macOS Intel 上的 `sympy` 与 `mpmath` 会被收窄成仅 mac-x64 生效，Windows 上等同于移除。

## Result Experience

- 新装用户完成第一次转写时，默认走 ONNX，提示下载 `iic/SenseVoiceSmall-onnx` 与 `speech_fsmn_vad_zh-cn-16k-common-onnx`，与现有模型下载流程一致。
- 已装用户升级后，默认模型变为 ONNX。此前显式选择过 PyTorch 族的用户，升级后落到 ONNX，并在设置页给一次说明，写明原因与恢复方式。
- 设置页模型列表仍是两项。PyTorch 族在缺少运行时组件时，条目旁标注需要下载组件，选择时先走组件下载。
- 安装器体积随包内容下降，安装耗时与写入量同步下降，安全软件可拦截的窗口随之缩短。

## Validation Rules

- 同一段音频分别走 ONNX 与 PyTorch，逐句比对转写结果。允许标点与断句差异，不允许内容缺失或串句。差异清单随发布记录留存。
- 干净机器上，未下载 PyTorch 组件时选中 PyTorch 族，不得崩溃，不得写入残缺文件，不得消耗额度。
- 组件指纹与 `uv.lock` 不一致时必须判定为缺失，不得复用旧目录。
- 外置之后，ONNX 路径用到的 `funasr_onnx`、`librosa`、`onnxruntime`、`modelscope` 必须仍能从包内直接导入。
- 度量口径固定为「排除 `__pycache__` 与 `*.pyc`」，否则会被本地 dev 生成的字节码污染，量出虚高的数。

## Acceptance Criteria

- `app/src-tauri/resources/python` 文件数 ≤ 18,000，体积 ≤ 550 MB（实测预期 17,454 个文件、529 MB）。
- 干净机器完成一次 YouTube 链接转写与一次本地音频转写，两者都使用默认 ONNX 模型。
- 设置页两个模型都能选中；PyTorch 族在组件缺失时给出下载入口，下载完成后能完成一次转写。
- 升级安装保留原有设置与历史，默认模型变化有一次性说明。
- 同一段音频的两种执行结果差异在发布记录中列出，且经过人工确认。

## Comparison Record（2026-10-20）

样本与过程：取模型仓库自带的官方示例音频（`models/models/iic/SenseVoiceSmall/example/`），用 ffmpeg 统一转成 16 kHz 单声道 PCM WAV；zh 与 en 各一段，另把五段语言样本加 0.6 秒静音拼成 46.2 秒的 13 段音频。两路都用 `frameq_worker` 的注册表入口构建，语言参数 `auto`，与生产管线传 `language=None` 的行为一致。探针脚本与逐句明细在 `build/asr-compare/`（本地运行期目录，不进 git）。

| 样本 | 时长 | 合并相似度 | 句数（PyTorch / ONNX） | 内容差异 |
| --- | --- | --- | --- | --- |
| zh | 5.6 s | 0.93 | 1 / 1 | 「开饭时间」与「开放时间」，一个字之差 |
| en | 7.2 s | 1.00 | 1 / 1 | 无 |
| mixed | 46.2 s | 0.91 | 4 / 7 | 「50 pieces of gold」与「code」，PyTorch 自己也输出过「good」 |

结论：三条都无内容缺失，语序一致，差异停留在同音字与个别单词。断句上 ONNX 更细，PyTorch 会把相邻语种并进一句（英文与日文合并、韩文与粤语合并），ONNX 的粒度反而更接近逐句。按 Validation Rules 的口径，**允许切默认模型**。

两点局限要如实记录：

- 样本是官方短句与合成拼接，没有覆盖真实长视频的噪声与背景音；发布前需要在真实视频上按本节流程再跑一次。
- PyTorch 路径在沙箱内加载模型会撞内存提交上限，比对在沙箱外执行；后续重跑同样要绕开沙箱。

## Risks

- 收益比最初预估的小。最初按未排除字节码的量算成 687 MB，实际可外置 421 MB，包内从 950 MB 降到约 529 MB，降幅 44%。安装器体积的下降幅度需要打包后实测，不能沿用旧估算。
- PyTorch 组件体积约 421 MB，下载体验与模型下载同级，断点续传与校验必须复用现有下载器的行为。
- ONNX 与 PyTorch 的输出差异若超出容忍度，默认模型不能切换，本规格需要重新评估。
- `funasr` 被外置后，PyTorch 版 VAD `speech_fsmn_vad_zh-cn-16k-common-pytorch` 也随之外置；若 ONNX VAD 在某段音频上表现异常，回退路径会变长。
