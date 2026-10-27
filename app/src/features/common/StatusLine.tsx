import type { ReactNode } from "react";

type StatusLineProps = {
  className?: string;
  id?: string;
  children: ReactNode;
};

/**
 * Single place that owns the polite status contract, so a notice never ships
 * without `role="status"` / `aria-live` again.
 */
export function StatusLine({
  className = "action-notice",
  id,
  children,
}: StatusLineProps) {
  return (
    <p className={className} id={id} role="status" aria-live="polite" aria-atomic="true">
      {children}
    </p>
  );
}
