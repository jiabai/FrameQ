import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ProductWindow } from "../components/ProductWindow";
import { ProgressStages } from "../components/ProgressStages";
import { tokens } from "../styles";

export const WorkflowIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const linkEnter = interpolate(frame, [0.15 * fps, 0.75 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });
  const submitEnter = interpolate(frame, [1.2 * fps, 1.85 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 134,
        paddingBottom: 285,
        background: "linear-gradient(180deg, #F8FAFC 0%, #EAF6FF 100%)",
        fontFamily: tokens.font.family,
      }}
    >
      <ProductWindow>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 138px",
            gap: 14,
            alignItems: "end",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 29,
                fontWeight: 880,
                color: tokens.colors.productInk,
                marginBottom: 14,
                letterSpacing: 0,
              }}
            >
              粘贴视频链接
            </div>
            <div
              style={{
                height: 66,
                border: `1px solid ${tokens.colors.productLine}`,
                borderRadius: tokens.layout.radius,
                padding: "18px 20px",
                color: tokens.colors.productMuted,
                fontSize: 21,
                fontWeight: 700,
                background: "#FFFFFF",
                overflow: "hidden",
                whiteSpace: "nowrap",
                transform: `translateX(${(1 - linkEnter) * -18}px)`,
                opacity: linkEnter,
              }}
            >
              https://example.com/public/video-7524
            </div>
          </div>
          <div
            style={{
              height: 66,
              borderRadius: tokens.layout.radius,
              background: tokens.colors.accentBlue,
              color: "#082F49",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 25,
              fontWeight: 900,
              transform: `scale(${0.94 + submitEnter * 0.06})`,
              opacity: submitEnter,
            }}
          >
            确认
          </div>
        </div>
        <div
          style={{
            marginTop: 26,
            borderTop: `1px solid ${tokens.colors.productLine}`,
            paddingTop: 24,
          }}
        >
          <ProgressStages startFrame={54} />
        </div>
      </ProductWindow>
    </AbsoluteFill>
  );
};
