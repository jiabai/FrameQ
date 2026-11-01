import { Copy, ExternalLink, FolderPlus, Info, PencilLine, Pin, PinOff, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { HistoryListItem } from "../../historyClient";
import { safeNoteSource } from "../../noteActionsClient";
import { getHistoryTitle } from "./shellNavigation";

export type NoteAction = "pin" | "rename" | "collection" | "copy_source" | "open_source" | "info" | "delete";

export type SidebarNoteMenuProps = {
  item: HistoryListItem;
  anchor: HTMLButtonElement;
  mutationDisabled: boolean;
  disabledReason: string;
  onAction: (action: NoteAction) => void;
  onClose: (restoreFocus: boolean) => void;
};

export function getSidebarNoteMenuPosition(
  anchor: { left: number; right: number; top: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 8;
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const width = Math.min(menu.width, maxWidth);
  const height = Math.min(menu.height, maxHeight);
  const preferredLeft = anchor.right + 6 + width <= viewport.width - margin
    ? anchor.right + 6 : anchor.left - width - 6;
  return {
    left: Math.max(margin, Math.min(preferredLeft, viewport.width - margin - width)),
    top: Math.max(margin, Math.min(anchor.top, viewport.height - margin - height)),
    maxWidth,
    maxHeight,
  };
}

function isAnchorAvailable(anchor: HTMLButtonElement): boolean {
  if (!anchor.isConnected || anchor.closest("[hidden], [inert], .is-collapsed")) return false;
  for (let element: HTMLElement | null = anchor; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

export function SidebarNoteMenu({ item, anchor, mutationDisabled, disabledReason, onAction, onClose }: SidebarNoteMenuProps) {
  const { t } = useTranslation("shell");
  const id = useId();
  const menuId = anchor.id ? `${anchor.id}-menu` : `${id}-note-menu`;
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closingRef = useRef(false);
  const focusedRef = useRef(false);
  const [position, setPosition] = useState<ReturnType<typeof getSidebarNoteMenuPosition> | null>(null);
  const metadataUnavailable = Boolean(item.noteMetadataError);
  const pinned = !metadataUnavailable && Boolean(item.noteMetadata?.pinned);
  const sourceAvailable = safeNoteSource(item.source) !== null;
  const mutationReason = mutationDisabled ? disabledReason : null;
  const metadataReason = metadataUnavailable ? t("noteMenu.metadataUnavailable") : mutationReason;
  const sourceReason = sourceAvailable ? null : t("noteMenu.sourceUnavailable");
  const definitions = [
    { action: "pin", label: pinned ? t("noteMenu.unpin") : t("noteMenu.pin"), Icon: pinned ? PinOff : Pin, reason: metadataReason },
    { action: "rename", label: t("noteMenu.rename"), Icon: PencilLine, reason: metadataReason },
    { action: "collection", label: t("noteMenu.collection"), Icon: FolderPlus, reason: mutationReason },
    { action: "copy_source", label: t("noteMenu.copy_source"), Icon: Copy, reason: sourceReason },
    { action: "open_source", label: t("noteMenu.open_source"), Icon: ExternalLink, reason: sourceReason },
    { action: "info", label: t("noteMenu.info"), Icon: Info, reason: null },
    { action: "delete", label: t("noteMenu.delete"), Icon: Trash2, reason: mutationReason },
  ] as const;

  const close = useCallback((restoreFocus: boolean) => {
    if (closingRef.current) return;
    closingRef.current = true;
    closeRef.current(restoreFocus);
  }, []);

  useLayoutEffect(() => {
    closingRef.current = false;
    focusedRef.current = false;
  }, [anchor, item.taskId]);

  useLayoutEffect(() => {
    if (!isAnchorAvailable(anchor)) { close(false); return; }
    const menu = menuRef.current;
    if (!menu) return;
    setPosition(getSidebarNoteMenuPosition(anchor.getBoundingClientRect(), menu.getBoundingClientRect(), {
      width: window.innerWidth, height: window.innerHeight,
    }));
  }, [anchor, item.taskId, pinned, mutationDisabled, metadataUnavailable, t, close]);

  useLayoutEffect(() => {
    if (!position || focusedRef.current || closingRef.current) return;
    focusedRef.current = true;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    function outsideInput(event: Event) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !anchor.contains(event.target)) close(false);
    }
    function scroll(event: Event) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      if (event.target === document || event.target === window ||
        (event.target instanceof Element && event.target.contains(anchor))) close(false);
    }
    const viewportChanged = () => close(false);
    const observer = new MutationObserver(() => { if (!isAnchorAvailable(anchor)) close(false); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style", "inert"] });
    document.addEventListener("pointerdown", outsideInput, true);
    document.addEventListener("focusin", outsideInput);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", viewportChanged);
    window.visualViewport?.addEventListener("resize", viewportChanged);
    window.visualViewport?.addEventListener("scroll", viewportChanged);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outsideInput, true);
      document.removeEventListener("focusin", outsideInput);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", viewportChanged);
      window.visualViewport?.removeEventListener("resize", viewportChanged);
      window.visualViewport?.removeEventListener("scroll", viewportChanged);
    };
  }, [anchor, close]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      if (isAnchorAvailable(anchor)) anchor.focus({ preventScroll: true });
      close(false);
      return;
    }
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? (current + 1) % buttons.length
      : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
      : null;
    if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
  }

  return createPortal(
    <div
      id={menuId}
      ref={menuRef}
      role="menu"
      aria-label={t("noteMenu.label", { title: getHistoryTitle(item) })}
      className="shell-note-menu"
      style={{ ...position, visibility: position ? "visible" : "hidden" }}
      onKeyDown={handleKeyDown}
    >
      {definitions.map(({ action, label, Icon, reason }, index) => (
        <Fragment key={action}>
          {index === 1 || index === 3 || index === 5 || index === 6 ? <div role="separator" className="shell-note-menu-separator" /> : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={action === "delete" ? "shell-note-menu-delete" : undefined}
            disabled={reason !== null}
            title={reason ?? undefined}
            aria-describedby={reason !== null ? `${menuId}-${action}-reason` : undefined}
            onClick={() => { if (reason === null && !closingRef.current) { close(true); onAction(action); } }}
          >
            <Icon size={16} aria-hidden="true" strokeWidth={1.7} />
            <span>{label}</span>
          </button>
          {reason !== null ? <span id={`${menuId}-${action}-reason`} className="shell-visually-hidden">{reason}</span> : null}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
