import { Composition } from "remotion";
import { FrameQPromo } from "./FrameQPromo";
import promoData from "./promoData.json";

export const RemotionRoot: React.FC = () => {
  const { composition } = promoData;

  return (
    <Composition
      id={composition.id}
      component={FrameQPromo}
      durationInFrames={composition.durationInFrames}
      fps={composition.fps}
      width={composition.width}
      height={composition.height}
    />
  );
};
