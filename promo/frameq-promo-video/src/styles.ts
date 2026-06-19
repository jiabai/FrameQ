import type { CSSProperties } from "react";

export const tokens = {
  colors: {
    ink: "#F8FAFC",
    muted: "#B7C2CF",
    panel: "rgba(9, 17, 29, 0.76)",
    panelStrong: "rgba(13, 23, 38, 0.92)",
    line: "rgba(255, 255, 255, 0.16)",
    accent: "#5EEAD4",
    accentWarm: "#FACC15",
    accentBlue: "#38BDF8",
    accentGreen: "#34D399",
    accentOrange: "#FB923C",
    background: "#0B1020",
    backgroundSoft: "#141B2D",
    surface: "#F8FAFC",
    surfaceWarm: "#FFF7ED",
    surfaceBlue: "#E0F2FE",
    surfaceGreen: "#DCFCE7",
    productInk: "#111827",
    productMuted: "#667085",
    productLine: "#D7DEE8",
  },
  font: {
    family:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
    captionSize: 58,
    captionLineHeight: 1.18,
    labelSize: 46,
  },
  layout: {
    safeX: 84,
    captionBottom: 118,
    captionMaxWidth: 920,
    radius: 8,
  },
  motion: {
    easeOut: [0.16, 1, 0.3, 1] as const,
  },
};

export const fillFrame: CSSProperties = {
  backgroundColor: tokens.colors.background,
  color: tokens.colors.ink,
  fontFamily: tokens.font.family,
  overflow: "hidden",
};
