import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { tokens } from "../styles";

export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};

export type CaptionGroup = {
  startFrame: number;
  endFrame: number;
  text: string;
  highlight: string;
};

type CaptionTrackProps = {
  captionWords: Caption[];
  groups: CaptionGroup[];
  keywords: string[];
};

const containsKeyTerm = (text: string, group: CaptionGroup | undefined, keywords: string[]) => {
  const terms = [group?.highlight, ...keywords].filter((term): term is string => Boolean(term));
  return terms.some((term) => text.includes(term));
};

export const CaptionTrack: React.FC<CaptionTrackProps> = ({ captionWords, groups, keywords }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  const activeGroup = groups.find(
    (group) => frame >= group.startFrame && frame < group.endFrame,
  );

  const visibleWords = captionWords.filter((caption) => {
    if (!activeGroup) {
      return caption.startMs <= currentMs && caption.endMs > currentMs;
    }

    const groupStartMs = (activeGroup.startFrame / fps) * 1000;
    const groupEndMs = (activeGroup.endFrame / fps) * 1000;
    return caption.endMs > groupStartMs && caption.startMs < groupEndMs;
  });

  if (!activeGroup || visibleWords.length === 0) {
    return null;
  }

  const groupLocalFrame = frame - activeGroup.startFrame;
  const entrance = interpolate(groupLocalFrame, [0, 12], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });
  const opacity = interpolate(groupLocalFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingLeft: tokens.layout.safeX,
        paddingRight: tokens.layout.safeX,
        paddingBottom: tokens.layout.captionBottom,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: tokens.layout.captionMaxWidth,
          transform: `translateY(${entrance}px)`,
          opacity,
          textAlign: "center",
          fontFamily: tokens.font.family,
          fontSize: tokens.font.captionSize,
          lineHeight: tokens.font.captionLineHeight,
          fontWeight: 800,
          letterSpacing: 0,
          color: tokens.colors.ink,
          textShadow: "0 4px 22px rgba(0, 0, 0, 0.62)",
          whiteSpace: "pre-wrap",
        }}
      >
        {visibleWords.map((caption) => {
          const isActive = caption.startMs <= currentMs && caption.endMs > currentMs;
          const isKeyTerm = containsKeyTerm(caption.text, activeGroup, keywords);

          return (
            <span
              key={`${caption.startMs}-${caption.endMs}-${caption.text}`}
              style={{
                color: isActive || isKeyTerm ? tokens.colors.accentWarm : tokens.colors.ink,
                backgroundColor: isActive ? "rgba(250, 204, 21, 0.16)" : "transparent",
                borderRadius: isActive ? tokens.layout.radius : 0,
                padding: isActive ? "0 8px 3px" : 0,
              }}
            >
              {caption.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
