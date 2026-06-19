import { Audio, AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { CaptionTrack } from "./components/CaptionTrack";
import { EndCard } from "./scenes/EndCard";
import { LocalFirst } from "./scenes/LocalFirst";
import { PainHook } from "./scenes/PainHook";
import { TopicIdeas } from "./scenes/TopicIdeas";
import { WorkflowIntro } from "./scenes/WorkflowIntro";
import promoData from "./promoData.json";
import { fillFrame, tokens } from "./styles";

const sceneMap: Record<string, React.FC> = {
  "pain-hook": PainHook,
  "workflow-intro": WorkflowIntro,
  "local-first": LocalFirst,
  "topic-ideas": TopicIdeas,
  "end-card": EndCard,
};

export const FrameQPromo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={fillFrame}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${tokens.colors.backgroundSoft} 0%, ${tokens.colors.background} 68%)`,
        }}
      />
      <Audio src={staticFile("voiceover.wav")} />
      {promoData.scenes.map((scene) => {
        const SceneComponent = sceneMap[scene.id];

        if (!SceneComponent) {
          return null;
        }

        return (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.endFrame - scene.startFrame}
            premountFor={fps}
          >
            <SceneComponent />
          </Sequence>
        );
      })}
      <CaptionTrack
        captionWords={promoData.captionWords}
        groups={promoData.captions}
        keywords={promoData.keywords}
      />
    </AbsoluteFill>
  );
};
