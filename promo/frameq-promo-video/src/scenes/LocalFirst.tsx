import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { tokens } from "../styles";

const files = [
  { name: "video.mp4", label: "视频文件", color: tokens.colors.surfaceBlue },
  { name: "audio.wav", label: "转写音频", color: "#FFFFFF" },
  { name: "transcript.md", label: "完整文字稿", color: tokens.colors.surfaceGreen },
];

export const LocalFirst: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleEnter = interpolate(frame, [0, 0.55 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #F7FFF9 0%, #EDFDF3 100%)",
        fontFamily: tokens.font.family,
        padding: "90px 84px 292px",
      }}
    >
      <div
        style={{
          fontSize: 70,
          fontWeight: 950,
          lineHeight: 1.08,
          letterSpacing: 0,
          color: tokens.colors.productInk,
          transform: `translateY(${(1 - titleEnter) * 26}px)`,
          opacity: titleEnter,
        }}
      >
        默认留在本机，
        <br />
        整理内容更安心。
      </div>
      <div
        style={{
          marginTop: 52,
          display: "grid",
          gridTemplateColumns: "1fr 210px",
          gap: 24,
          alignItems: "center",
        }}
      >
        <div style={{ display: "grid", gap: 16 }}>
          {files.map((file, index) => {
            const enter = interpolate(frame, [20 + index * 16, 48 + index * 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(...tokens.motion.easeOut),
            });

            return (
              <div
                key={file.name}
                style={{
                  height: 108,
                  border: `1px solid ${tokens.colors.productLine}`,
                  borderRadius: tokens.layout.radius,
                  background: file.color,
                  boxShadow: "0 18px 46px rgba(21, 128, 61, 0.12)",
                  padding: "20px 24px",
                  display: "grid",
                  gridTemplateColumns: "54px 1fr",
                  gap: 18,
                  alignItems: "center",
                  transform: `translateX(${(1 - enter) * -38}px)`,
                  opacity: enter,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 62,
                    borderRadius: 6,
                    background: "#FFFFFF",
                    border: `1px solid ${tokens.colors.productLine}`,
                    boxShadow: "inset 0 -10px 0 rgba(15, 23, 42, 0.05)",
                  }}
                />
                <div>
                  <div
                    style={{
                      color: tokens.colors.productInk,
                      fontSize: 29,
                      fontWeight: 880,
                    }}
                  >
                    {file.label}
                  </div>
                  <div
                    style={{
                      color: tokens.colors.productMuted,
                      fontSize: 18,
                      fontWeight: 720,
                      marginTop: 5,
                    }}
                  >
                    本地输出 / {file.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            height: 210,
            borderRadius: tokens.layout.radius,
            border: "1px solid rgba(52, 211, 153, 0.55)",
            background: "rgba(220, 252, 231, 0.92)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#065F46",
            boxShadow: "0 28px 70px rgba(21, 128, 61, 0.18)",
          }}
        >
          <div style={{ fontSize: 62, fontWeight: 950, lineHeight: 1 }}>✓</div>
          <div style={{ fontSize: 22, fontWeight: 900, marginTop: 10 }}>本地优先</div>
        </div>
      </div>
      <div
        style={{
          marginTop: 36,
          width: 790,
          color: "#166534",
          fontSize: 25,
          fontWeight: 780,
          lineHeight: 1.35,
        }}
      >
        默认处理视频、音频和文字稿；仅当你主动配置云端 LLM 时，相关文字片段才会发送到外部服务。
      </div>
    </AbsoluteFill>
  );
};
