/**
 * Display names for the ASR model ids exposed by the desktop settings.
 * The id list itself is owned by the Rust side (`supported_asr_models`).
 */
const ASR_MODEL_LABELS: Record<string, string> = {
  "iic/SenseVoiceSmall": "SenseVoice Small",
  "iic/SenseVoiceSmall-onnx": "SenseVoiceSmall-ONNX (≈ 230 MB)",
};

/**
 * Unknown ids fall back to the model name without its namespace so a newly
 * supported model never renders as a raw `org/model` id.
 */
export function asrModelLabel(model: string): string {
  return ASR_MODEL_LABELS[model] ?? model.split("/").pop() ?? model;
}
