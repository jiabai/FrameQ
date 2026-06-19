import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { tokens } from "../styles";

const fragments = [
  { title: "公开讲座片段", meta: "18:42 / 观点密集", color: tokens.colors.surfaceBlue },
  { title: "产品访谈剪辑", meta: "31:05 / 需要复盘", color: "#FFFFFF" },
  { title: "会议分享视频", meta: "12:18 / 灵感很多", color: tokens.colors.surfaceWarm },
];

const notes = ["反复听", "手动摘句", "整理太慢", "选题容易散"];

export const PainHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleEnter = interpolate(frame, [0, 0.7 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${tokens.colors.backgroundSoft} 0%, ${tokens.colors.background} 72%)`,
        fontFamily: tokens.font.family,
        padding: "92px 84px 280px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          color: tokens.colors.ink,
          fontSize: 78,
          fontWeight: 950,
          lineHeight: 1.07,
          letterSpacing: 0,
          transform: `translateY(${(1 - titleEnter) * 28}px)`,
          opacity: titleEnter,
          width: 840,
        }}
      >
        好内容刷过去，
        <br />
        灵感也跟着散了？
      </div>

      <div style={{ position: "relative", marginTop: 62, height: 520 }}>
        {fragments.map((item, index) => {
          const enter = interpolate(frame, [index * 10 + 6, index * 10 + 34], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(...tokens.motion.easeOut),
          });
          const x = [-14, 110, 36][index];
          const y = [8, 168, 330][index];
          const rotate = [-5, 4, -2][index];

          return (
            <div
              key={item.title}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: 690,
                height: 142,
                borderRadius: tokens.layout.radius,
                border: `1px solid ${tokens.colors.productLine}`,
                background: item.color,
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.24)",
                transform: `translateX(${(1 - enter) * 110}px) rotate(${rotate}deg)`,
                opacity: enter,
                display: "grid",
                gridTemplateColumns: "112px 1fr",
                gap: 20,
                alignItems: "center",
                padding: 18,
              }}
            >
              <div
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 6,
                  background:
                    index === 0
                      ? tokens.colors.accentBlue
                      : index === 1
                        ? tokens.colors.accentOrange
                        : tokens.colors.accentGreen,
                }}
              />
              <div>
                <div
                  style={{
                    color: tokens.colors.productInk,
                    fontSize: 31,
                    fontWeight: 880,
                    lineHeight: 1.15,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    color: tokens.colors.productMuted,
                    fontSize: 19,
                    fontWeight: 700,
                    marginTop: 8,
                  }}
                >
                  {item.meta}
                </div>
              </div>
            </div>
          );
        })}
        {notes.map((note, index) => {
          const enter = interpolate(frame, [36 + index * 7, 56 + index * 7], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(...tokens.motion.easeOut),
          });

          return (
            <div
              key={note}
              style={{
                position: "absolute",
                right: [72, 0, 96, 28][index],
                top: [24, 146, 274, 402][index],
                border: `1px solid rgba(255, 255, 255, 0.24)`,
                borderRadius: tokens.layout.radius,
                background: "rgba(255, 255, 255, 0.09)",
                color: tokens.colors.ink,
                padding: "14px 18px",
                fontSize: 24,
                fontWeight: 850,
                opacity: enter,
                transform: `translateY(${(1 - enter) * -22}px)`,
              }}
            >
              {note}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 84,
          right: 84,
          bottom: 262,
          border: `1px solid rgba(94, 234, 212, 0.34)`,
          borderRadius: tokens.layout.radius,
          background: "rgba(8, 145, 178, 0.18)",
          color: tokens.colors.ink,
          padding: "20px 24px",
          fontSize: 27,
          fontWeight: 850,
          lineHeight: 1.25,
        }}
      >
        只处理公开或已授权的视频链接，把时间留给思考。
      </div>
    </AbsoluteFill>
  );
};
