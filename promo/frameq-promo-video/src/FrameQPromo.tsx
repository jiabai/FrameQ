import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import promoData from "./promoData.json";
import { fillFrame, tokens } from "./styles";

export const FrameQPromo: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = interpolate(frame % 120, [0, 60, 120], [0.35, 0.7, 0.35], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={fillFrame}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${tokens.colors.backgroundSoft} 0%, ${tokens.colors.background} 68%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: tokens.layout.safeX,
        }}
      >
        <div
          style={{
            width: 840,
            border: `1px solid ${tokens.colors.line}`,
            borderRadius: tokens.layout.radius,
            background: tokens.colors.panelStrong,
            boxShadow: `0 0 120px rgba(94, 234, 212, ${glow})`,
            padding: 56,
          }}
        >
          <div
            style={{
              color: tokens.colors.accent,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 0,
              marginBottom: 28,
              textTransform: "uppercase",
            }}
          >
            Creative reset
          </div>
          <div
            style={{
              color: tokens.colors.ink,
              fontSize: 86,
              fontWeight: 950,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            {promoData.draft.title}
          </div>
          <div
            style={{
              color: tokens.colors.muted,
              fontSize: 34,
              fontWeight: 650,
              letterSpacing: 0,
              lineHeight: 1.35,
              marginTop: 28,
            }}
          >
            {promoData.draft.note}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
