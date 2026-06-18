# Core Beliefs

## Installer-ready local runtime

对外分发版本必须让普通用户安装后直接使用。安装包可以内置 FrameQ 核心本地 ASR 模型权重，但只限明确版本的核心 ASR 模型（首版为 SenseVoice Small）；LLM API key、云端 LLM 模型和用户私有配置不得内置。安装包必须同时内置 Python runtime、worker、媒体工具和必要依赖，运行期不得要求用户安装 Python、uv、ffmpeg 或手动设置环境变量。

<!-- 由 vibe-coding-launcher 生成。 -->

## 1. Local-first by default

视频、音频、文字稿和导出文件默认留在用户本机。只有当用户配置云端 LLM 并明确知道文字稿会发送出去时，才允许外部调用。

## 2. Worker owns heavy processing

下载、媒体校验、音频提取、ASR 和话题点生成都由 Python worker 承担。UI 只负责输入、状态、取消、重试、展示和导出。

## 3. Runtime independence

InsightFlow 参考仓库只能作为开发来源。FrameQ 运行期必须依赖本项目内置代码，而不是依赖 `D:\Github\InsightFlow\src\server` 这个本机路径。

## 4. Recoverable partial success

只要文字稿生成成功，就不能因为话题点失败而丢弃结果。客户端进入 `部分完成`，允许重试话题点生成。

## 5. Observable progress

每个长耗时阶段都必须有可见状态、取消入口或可恢复错误；不能让用户面对无反馈等待。
