import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedSheet } from "../modal/AnimatedSheet";
import "./notes.css";

export type NoteActionSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function NoteActionSheet({ open, title, onClose, closeDisabled = false, className = "", children, footer }: NoteActionSheetProps) {
  const { t } = useTranslation("noteActions");
  const close = () => { if (!closeDisabled) onClose(); };
  return (
    <AnimatedSheet
      open={open}
      ariaLabel={title}
      className={`note-action-sheet ${className}`}
      onBackdropClick={close}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <header className="note-action-header">
        <h2>{title}</h2>
        <button type="button" className="note-action-close" aria-label={t("common.close")} onClick={close} disabled={closeDisabled}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="note-action-content sheet-body">{children}</div>
      {footer ? <footer className="note-action-footer sheet-footer">{footer}</footer> : null}
    </AnimatedSheet>
  );
}
