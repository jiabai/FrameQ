# 安装包瘦身：默认切 ONNX 与 PyTorch 运行时外置

## Background

2026-10-20 的首次安装失败报告把安装阶段的写入量摆到了台面上：包内 `resources/python` 是 36,588 个文件、1,081 MB，安装器顺序解压，安全软件有十几分钟窗口可以拦截。

实测分布（`app/src-tauri/resources/python`，按文件字节求和）：

| 项 | 文件数 | 体积 |
| --- | --- | --- |
| 合计 | 36,588 | 1,081 MB |
| `Lib/site-packages` 合计 | 34,157 | 1,026 MB |
| torch | 3,160 | 338 MB |
| transformers | 2,286 | 52 MB |
| sympy | 1,298 | 28 MB |
| sklearn | 779 | 25 MB |
| llvmlite | 61 | 102 MB |
| numba | 499 | 10 MB |
| torchaudio | 154 | 2 MB |
| funasr | 834 | 8 MB |
| 字节码 `*.pyc` | 11,188 | 122 MB |

torch 这一整套只服务 PyTorch 族的两个模型（`iic/SenseVoiceSmall` 与 `Qwen/Qwen3-ASR-0.6B`），而默认模型恰好是 PyTorch 版，于是它变成必需项。字节码是 pip 安装时顺手编译出来的产物，属于安装期的一次性成本。

两项合计可以移出 20,259 个文件与 687 MB。

## Goals

- 默认模型从 `iic/SenseVoiceSmall` 切到 `iic/SenseVoiceSmall-onnx`。
- PyTorch 族的运行时（torch、torchaudio、llvmlite、numba、transformers、sympy、scikit-learn、funasr）移出安装包，改为用户选中对应模型时下载的独立组件。
- 安装包不再分发 `*.pyc`，由 Python 在目标机首次导入时就地生成。
- 安装后 `resources/python` 的文件数降到 17,000 以内，体积降到 400 MB 以内。

三个模型仍然可选，功能不减。

## Non-goals

- 不改 ONNX 运行时的组成，`funasr-onnx`、`onnxruntime`、`scipy`、`librosa`、`jieba`、`kaldi-native-fbank`、`sentencepiece` 继续留在安装包内。
- 不改模型文件的缓存位置、下载通道与进度事件。
- 不改 `installMode`、默认安装目录，以及已经提交的 NSIS 钩子。
- 不动 `tcl`、`pip` 与站点包里的测试目录，它们体积有限，留待单独评估。

## Runtime Component

PyTorch 族所需的运行时单独打包，内容为该族模型的依赖闭包，由构建脚本用 `uv export` 生成。

- 存放：`%LOCALAPPDATA%\FrameQ\runtime\pytorch\<版本号>\`。
- 触发：用户在设置页选中 `iic/SenseVoiceSmall` 或 `Qwen/Qwen3-ASR-0.6B` 且本机缺少该组件时，界面提示需要下载，用户确认后开始。
- 注入：worker 仅在选中 PyTorch 族时把该目录加入 `PYTHONPATH`，ONNX 路径不受影响。
- 版本：组件内写入清单文件，记录 `uv.lock` 的解析指纹。指纹与当前 worker 不一致时按缺失处理，重新下载。
- 失败：下载或校验失败时不改动已有文件，界面提供重试，不消耗 AI 额度。

`Qwen3-ASR` 额外需要 `qwen-asr`，它今天不在捆绑运行时里，一并放进该组件。

## Result Experience

- 新装用户完成第一次转写时，默认走 ONNX，提示下载 `iic/SenseVoiceSmall-onnx` 与 `speech_fsmn_vad_zh-cn-16k-common-onnx`，与现有模型下载流程一致。
- 已装用户升级后，默认模型变为 ONNX。此前显式选择过 PyTorch 族的用户，升级后落到 ONNX，并在设置页给一次说明，写明原因与恢复方式。
- 设置页模型列表仍是三项。PyTorch 族在缺少运行时组件时，条目旁标注需要下载组件，选择时先走组件下载。
- 字节码不再随包分发。首次任务会比升级前慢若干秒，之后恢复正常。

## Validation Rules

- 同一段音频分别走 ONNX 与 PyTorch，逐句比对转写结果。允许标点与断句差异，不允许内容缺失或串句。差异清单随发布记录留存。
- 干净机器上，未下载 PyTorch 组件时选中 PyTorch 族，不得崩溃，不得写入残缺文件，不得消耗额度。
- 组件指纹与 `uv.lock` 不一致时必须判定为缺失，不得复用旧目录。
- 移除字节码后，所有入口模块仍能从源码导入；安装目录不可写时只损失首启速度，不得报错。

## Acceptance Criteria

- `app/src-tauri/resources/python` 文件数 ≤ 17,000，体积 ≤ 400 MB，安装器体积随之下降。
- 干净机器完成一次 YouTube 链接转写与一次本地音频转写，两者都使用默认 ONNX 模型。
- 设置页三个模型都能选中；PyTorch 族在组件缺失时给出下载入口，下载完成后能完成一次转写。
- 升级安装保留原有设置与历史，默认模型变化有一次性说明。
- 同一段音频的两种执行结果差异在发布记录中列出，且经过人工确认。

## Risks

- 移除字节码会让首次任务变慢，具体秒数需要在目标机实测后写进发布说明。
- PyTorch 组件体积约 570 MB，下载体验与模型下载同级，断点续传与校验必须复用现有下载器的行为。
- ONNX 与 PyTorch 的输出差异若超出容忍度，默认模型不能切换，本规格需要重新评估。
