import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { tokens } from "../styles";

type TopicCardProps = {
  text: string;
  index: number;
};

export const TopicCard: React.FC<TopicCardProps> = ({ text, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = index * 0.3 * fps;
  const enter = interpolate(frame, [start, start + 0.42 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <div
      style={{
        width: 760,
        minHeight: 112,
        border: `1px solid ${
          index % 2 === 0 ? "rgba(251, 146, 60, 0.45)" : "rgba(56, 189, 248, 0.45)"
        }`,
        borderRadius: tokens.layout.radius,
        background: index % 2 === 0 ? tokens.colors.surfaceWarm : tokens.colors.surfaceBlue,
        padding: "22px 26px",
        fontFamily: tokens.font.family,
        fontSize: 30,
        fontWeight: 850,
        lineHeight: 1.28,
        letterSpacing: 0,
        color: tokens.colors.productInk,
        boxShadow: "0 18px 46px rgba(15, 23, 42, 0.16)",
        transform: `translateY(${(1 - enter) * 30}px) scale(${0.97 + enter * 0.03})`,
        opacity: enter,
      }}
    >
      {text}
    </div>
  );
};
