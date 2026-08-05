---
question: "ASR 模型在哪里下载？安装包内置了吗？"
order: 1
---

ASR 模型在首次提交已验证任务时按所选模型按需下载到 app-local data，不内置在安装包中。默认 PyTorch SenseVoiceSmall 模型保留不变，新增可选 `funasr_onnx` 运行时。启动时不会自动下载模型，取消或失败不会创建任务。
