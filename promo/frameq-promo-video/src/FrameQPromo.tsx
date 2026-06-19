import { Audio, AbsoluteFill, Easing, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CaptionTrack } from "./components/CaptionTrack";
import promoData from "./promoData.json";
import { fillFrame, tokens } from "./styles";

type Scene = (typeof promoData.scenes)[number];

const ScenePlaceholder: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 0.45 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });
  const y = interpolate(frame, [0, 0.55 * fps], [28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingLeft: tokens.layout.safeX,
        paddingRight: tokens.layout.safeX,
      }}
    >
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity,
          width: "100%",
          border: `1px solid ${tokens.colors.line}`,
          borderRadius: tokens.layout.radius,
          background: tokens.colors.panel,
          padding: "54px 58px",
          boxShadow: "0 28px 90px rgba(0, 0, 0, 0.26)",
        }}
      >
        <div
          style={{
            color: tokens.colors.accent,
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: 0,
            marginBottom: 18,
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </div>
        <div
          style={{
            color: tokens.colors.ink,
            fontSize: tokens.font.labelSize,
            lineHeight: 1.12,
            fontWeight: 850,
            letterSpacing: 0,
          }}
        >
          {scene.label}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const FrameQPromo: React.FC = () => {
  return (
    <AbsoluteFill style={fillFrame}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${tokens.colors.backgroundSoft} 0%, ${tokens.colors.background} 68%)`,
        }}
      />
      <Audio src={staticFile("voiceover.wav")} />
      {promoData.scenes.map((scene, index) => (
        <Sequence
          key={scene.id}
          from={scene.startFrame}
          durationInFrames={scene.endFrame - scene.startFrame}
        >
          <ScenePlaceholder scene={scene} index={index} />
        </Sequence>
      ))}
      <CaptionTrack
        captionWords={promoData.captionWords}
        groups={promoData.captions}
        keywords={promoData.keywords}
      />
    </AbsoluteFill>
  );
};
