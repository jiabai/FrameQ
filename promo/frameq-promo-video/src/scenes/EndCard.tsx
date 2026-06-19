import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import promoData from "../promoData.json";
import { tokens } from "../styles";

const tags = ["本地优先", "公开视频转写", "话题点生成", "轻量分发"];

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = interpolate(frame, [0, 0.7 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  const visibleTags = promoData.keywords.length === 4 ? promoData.keywords : tags;

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #F1F5F9 100%)",
        fontFamily: tokens.font.family,
        padding: "92px 84px 282px",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `translateY(${(1 - enter) * 26}px)`,
          opacity: enter,
        }}
      >
        <div
          style={{
            fontSize: 104,
            fontWeight: 980,
            color: tokens.colors.productInk,
            lineHeight: 1,
            letterSpacing: 0,
          }}
        >
          FrameQ
        </div>
        <div
          style={{
            width: 850,
            fontSize: 42,
            fontWeight: 860,
            color: tokens.colors.productMuted,
            lineHeight: 1.18,
            marginTop: 24,
          }}
        >
          把公开视频变成文字稿和灵感入口
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 54, width: 820 }}>
          {visibleTags.map((keyword, index) => (
            <div
              key={`${keyword}-${index}`}
              style={{
                border: `1px solid ${
                  index % 2 === 0 ? "rgba(56, 189, 248, 0.45)" : "rgba(251, 146, 60, 0.45)"
                }`,
                borderRadius: tokens.layout.radius,
                padding: "15px 19px",
                background: index % 2 === 0 ? tokens.colors.surfaceBlue : tokens.colors.surfaceWarm,
                fontSize: 29,
                fontWeight: 870,
                color: tokens.colors.productInk,
                minWidth: 176,
                textAlign: "center",
              }}
            >
              {keyword}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 58,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 70,
            padding: "0 30px",
            borderRadius: tokens.layout.radius,
            background: tokens.colors.productInk,
            color: "#FFFFFF",
            fontSize: 27,
            fontWeight: 900,
          }}
        >
          开始整理第一条视频
        </div>
      </div>
    </AbsoluteFill>
  );
};
