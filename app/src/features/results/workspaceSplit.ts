export function workspaceSplit(width: number, preferredAiRatio: number | null) {
  if (!Number.isFinite(width) || width < 0 ||
      (preferredAiRatio !== null && (!Number.isFinite(preferredAiRatio) || preferredAiRatio < 0 || preferredAiRatio > 1))) {
    throw new RangeError("Invalid workspace split dimensions");
  }
  const minimum = Math.min(280, width / 2);
  const maximum = width - minimum;
  const preferred = preferredAiRatio === null ? Math.min(width * 0.38, 620) : width * preferredAiRatio;
  const ai = Math.max(minimum, Math.min(maximum, preferred));
  return { ai, local: width - ai, minimum, maximum, resizable: width > 560 };
}
