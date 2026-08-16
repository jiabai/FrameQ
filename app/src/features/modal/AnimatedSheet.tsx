import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactNode,
} from "react";

import { useModalFocus } from "./useModalFocus";
import { UI_MOTION_SHEET_TRANSITION } from "../../uiMotion";

export type AnimatedSheetPhase = "open" | "closing" | "hidden";

type AnimatedSheetPhaseInput = {
  open: boolean;
  present: boolean;
  exitComplete: boolean;
};

export function resolveAnimatedSheetPhase({
  open,
  present,
  exitComplete,
}: AnimatedSheetPhaseInput): AnimatedSheetPhase {
  if (open) {
    return "open";
  }
  if (!present || exitComplete) {
    return "hidden";
  }
  return "closing";
}

type AnimatedSheetProps = {
  open: boolean;
  ariaLabel: string;
  className: string;
  onBackdropClick: MouseEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  children: ReactNode;
};

export function AnimatedSheet({
  open,
  ariaLabel,
  className,
  onBackdropClick,
  onKeyDown,
  children,
}: AnimatedSheetProps) {
  const [present, setPresent] = useState(open);
  const [exitComplete, setExitComplete] = useState(!open);
  const openRef = useRef(open);
  openRef.current = open;
  const sheetModalRef = useModalFocus<HTMLElement>(present);

  useEffect(() => {
    if (open) {
      setPresent(true);
      setExitComplete(false);
    }
  }, [open]);

  const phase = resolveAnimatedSheetPhase({ open, present, exitComplete });
  const handleAnimationComplete = useCallback(() => {
    if (!openRef.current) {
      setExitComplete(true);
      setPresent(false);
    }
  }, []);

  if (!present) {
    return null;
  }

  const visible = phase === "open";
  return (
    <motion.div
      className="modal-backdrop sheet-backdrop"
      data-motion="sheet"
      data-motion-state={phase}
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={UI_MOTION_SHEET_TRANSITION}
      onAnimationComplete={handleAnimationComplete}
      onClick={onBackdropClick}
    >
      <motion.section
        ref={sheetModalRef}
        className={`sheet-panel detail-modal ${className}`}
        data-motion="sheet-panel"
        aria-label={ariaLabel}
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={
          visible
            ? { opacity: 1, y: 0, scale: 1 }
            : { opacity: 0, y: 8, scale: 0.99 }
        }
        transition={UI_MOTION_SHEET_TRANSITION}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </motion.section>
    </motion.div>
  );
}
