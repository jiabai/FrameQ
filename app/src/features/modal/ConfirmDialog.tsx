import { useId } from "react";

import { AnimatedSheet } from "./AnimatedSheet";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  cancelLabel,
  confirmLabel,
  disabled = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const messageId = useId();
  const cancel = () => {
    if (open && !disabled) onCancel();
  };

  return (
    <AnimatedSheet
      open={open}
      role="alertdialog"
      ariaLabel={title}
      ariaDescribedBy={messageId}
      className="confirm-dialog"
      onBackdropClick={cancel}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <header className="modal-header sheet-header confirm-dialog-header">
        <h2>{title}</h2>
      </header>
      <div className="modal-content sheet-body confirm-dialog-content">
        <p id={messageId}>{message}</p>
      </div>
      <footer className="sheet-footer confirm-dialog-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={disabled || !open}
          data-modal-initial-focus
          onClick={cancel}
        >
          {cancelLabel}
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={disabled || !open}
          onClick={() => { if (open && !disabled) onConfirm(); }}
        >
          {confirmLabel}
        </button>
      </footer>
    </AnimatedSheet>
  );
}
