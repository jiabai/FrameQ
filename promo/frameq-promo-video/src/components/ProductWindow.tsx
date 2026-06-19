import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { tokens } from "../styles";

type ProductWindowProps = {
  children: ReactNode;
  title?: string;
};

export const ProductWindow: React.FC<ProductWindowProps> = ({
  children,
  title = "FrameQ",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = interpolate(frame, [0, 0.55 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...tokens.motion.easeOut),
  });

  return (
    <div
      style={{
        width: 852,
        border: `1px solid ${tokens.colors.productLine}`,
        borderRadius: tokens.layout.radius,
        background: "rgba(255, 255, 255, 0.97)",
        boxShadow: "0 36px 95px rgba(2, 8, 23, 0.26)",
        overflow: "hidden",
        fontFamily: tokens.font.family,
        transform: `translateY(${(1 - enter) * 26}px) scale(${0.982 + enter * 0.018})`,
        opacity: enter,
      }}
    >
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 20px",
          borderBottom: `1px solid ${tokens.colors.productLine}`,
          background: "#FBFDFF",
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#EF4444" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#F59E0B" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#22C55E" }} />
        <strong
          style={{
            marginLeft: 12,
            color: tokens.colors.productInk,
            fontSize: 20,
            fontWeight: 850,
            letterSpacing: 0,
          }}
        >
          {title}
        </strong>
        <div
          style={{
            marginLeft: "auto",
            color: tokens.colors.productMuted,
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          本地任务
        </div>
      </div>
      <div style={{ padding: 28 }}>{children}</div>
    </div>
  );
};
