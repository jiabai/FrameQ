import { Easing, interpolate, useCurrentFrame } from "remotion";
import { tokens } from "../styles";

const stages = [
  { label: "视频提取", detail: "校验公开视频链接与媒体文件" },
  { label: "视频转译", detail: "生成可阅读的文字稿" },
  { label: "话题点生成", detail: "提炼讨论角度与选题问题" },
];

type ProgressStagesProps = {
  startFrame?: number;
};

export const ProgressStages: React.FC<ProgressStagesProps> = ({ startFrame = 0 }) => {
  const frame = useCurrentFrame() - startFrame;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {stages.map((stage, index) => {
        const progress = interpolate(frame, [index * 32, index * 32 + 26], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(...tokens.motion.easeOut),
        });
        const isComplete = progress > 0.96;

        return (
          <div
            key={stage.label}
            style={{
              display: "grid",
              gridTemplateColumns: "34px 1fr",
              gap: 14,
              alignItems: "center",
              minHeight: 78,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: isComplete ? tokens.colors.accentGreen : tokens.colors.surfaceBlue,
                border: `1px solid ${
                  isComplete ? tokens.colors.accentGreen : tokens.colors.accentBlue
                }`,
                boxShadow: isComplete
                  ? "0 0 0 7px rgba(52, 211, 153, 0.14)"
                  : "0 0 0 7px rgba(56, 189, 248, 0.12)",
              }}
            />
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    color: tokens.colors.productInk,
                    fontSize: 25,
                    fontWeight: 850,
                    letterSpacing: 0,
                  }}
                >
                  {stage.label}
                </div>
                <div
                  style={{
                    color: tokens.colors.productMuted,
                    fontSize: 16,
                    fontWeight: 750,
                  }}
                >
                  {Math.round(progress * 100)}%
                </div>
              </div>
              <div
                style={{
                  color: tokens.colors.productMuted,
                  fontSize: 15,
                  fontWeight: 650,
                  marginTop: 4,
                }}
              >
                {stage.detail}
              </div>
              <div
                style={{
                  height: 8,
                  marginTop: 10,
                  background: "#E5EAF0",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: isComplete
                      ? tokens.colors.accentGreen
                      : tokens.colors.accentBlue,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
