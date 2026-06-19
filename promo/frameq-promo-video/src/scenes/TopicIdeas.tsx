import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { TopicCard } from "../components/TopicCard";
import promoData from "../promoData.json";
import { tokens } from "../styles";

const transcriptLines = [
  "00:18 用户真正需要的不是更多内容，而是可复用的线索。",
  "01:42 一段公开访谈里，常常藏着下一个选题的入口。",
  "03:06 把文字稿整理成问题，团队讨论会更快开始。",
];

export const TopicIdeas: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const split = interpolate(frame, [0.8 * fps, 1.55 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #FFF7ED 0%, #F8FAFC 100%)",
        fontFamily: tokens.font.family,
        padding: "78px 78px 282px",
      }}
    >
      <div
        style={{
          fontSize: 66,
          fontWeight: 950,
          color: tokens.colors.productInk,
          lineHeight: 1.08,
          letterSpacing: 0,
        }}
      >
        不止转文字，
        <br />
        还能提炼话题点。
      </div>

      <div
        style={{
          marginTop: 42,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 14,
          width: 850,
          opacity: 1 - split * 0.15,
          transform: `translateY(${-split * 34}px)`,
        }}
      >
        {transcriptLines.map((line, index) => (
          <div
            key={line}
            style={{
              border: `1px solid ${tokens.colors.productLine}`,
              borderRadius: tokens.layout.radius,
              background: "#FFFFFF",
              color: index === 1 ? "#9A3412" : tokens.colors.productMuted,
              padding: "18px 22px",
              fontSize: 20,
              fontWeight: index === 1 ? 850 : 700,
              lineHeight: 1.32,
              boxShadow: "0 14px 38px rgba(15, 23, 42, 0.08)",
            }}
          >
            {line}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          marginTop: 28,
          transform: `translateY(${(1 - split) * 44}px)`,
        }}
      >
        {promoData.topicCards.map((text, index) => (
          <TopicCard key={text} text={text} index={index} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
