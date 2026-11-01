import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { workspaceSplit } from "./workspaceSplit";

type TaskWorkspaceLayoutProps = {
  title: string;
  local: ReactNode;
  ai: ReactNode;
};

export function TaskWorkspaceLayout({ title, local, ai }: TaskWorkspaceLayoutProps) {
  const { t } = useTranslation("synthesis");
  const [expanded, setExpanded] = useState(true);
  const [preferredAiRatio, setPreferredAiRatio] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [animatePane, setAnimatePane] = useState(true);
  const layoutRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offset: number; initialRatio: number | null } | null>(null);
  const localPaneId = useId();
  const aiPaneId = useId();
  const aiPaneRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggleLabel = t(expanded ? "workspace.hide" : "workspace.show");
  const split = workspaceSplit(width, preferredAiRatio);
  const percent = (value: number) => width ? Math.round(value / width * 1000) / 10 : 50;

  function endDrag(restore = false) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    if (restore) setPreferredAiRatio(drag.initialRatio);
    const separator = separatorRef.current;
    if (separator?.hasPointerCapture(drag.pointerId)) separator.releasePointerCapture(drag.pointerId);
  }

  useLayoutEffect(() => {
    const measuredWidth = layoutRef.current!.getBoundingClientRect().width;
    if (measuredWidth !== width) {
      endDrag();
      setWidth(measuredWidth);
    }
  });

  useEffect(() => {
    const view = layoutRef.current!.ownerDocument.defaultView!;
    const resize = () => {
      endDrag();
      setWidth(layoutRef.current!.getBoundingClientRect().width);
    };
    const blur = () => endDrag();
    view.addEventListener("resize", resize);
    view.addEventListener("blur", blur);
    return () => {
      view.removeEventListener("resize", resize);
      view.removeEventListener("blur", blur);
    };
  }, []);

  function moveDivider(clientX: number, offset: number) {
    const bounds = layoutRef.current!.getBoundingClientRect();
    const next = workspaceSplit(bounds.width, Math.max(0, Math.min(1, (bounds.right - clientX + offset) / bounds.width)));
    setAnimatePane(false);
    setPreferredAiRatio(next.ai / bounds.width);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current || !split.resizable || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offset: event.clientX - (bounds.left + bounds.width / 2), initialRatio: preferredAiRatio };
    event.currentTarget.setPointerCapture(event.pointerId);
    setAnimatePane(false);
    setDragging(true);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && dragRef.current) {
      event.preventDefault();
      endDrag(true);
      return;
    }
    if (!split.resizable || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    endDrag();
    const bounds = layoutRef.current!.getBoundingClientRect();
    const current = workspaceSplit(bounds.width, preferredAiRatio);
    const local = event.key === "Home" ? current.minimum : event.key === "End" ? current.maximum
      : current.local + (event.key === "ArrowLeft" ? -10 : 10);
    moveDivider(bounds.left + local, 0);
  }

  function toggleAi() {
    endDrag();
    const pane = aiPaneRef.current;
    if (expanded && pane && (pane.contains(pane.ownerDocument.activeElement) || pane.ownerDocument.activeElement === separatorRef.current)) {
      toggleRef.current?.focus({ preventScroll: true });
    }
    setAnimatePane(true);
    setExpanded((current) => !current);
  }

  return (
    <div
      className={`task-workspace-surface${expanded ? "" : " is-ai-collapsed"}${animatePane ? "" : " is-split-adjusting"}${dragging ? " is-split-dragging" : ""}`}
      style={preferredAiRatio === null ? undefined : { "--workspace-ai-width": `${preferredAiRatio * 100}%` } as CSSProperties}
    >
      <header className="task-workspace-heading">
        <h1 className="task-workspace-note-title" title={title}>{title}</h1>
        <div className="task-workspace-ai-heading" aria-hidden={!expanded} inert={!expanded}>
          <h2>{t("workspace.title")}</h2>
        </div>
        <button
          ref={toggleRef}
          className={`task-workspace-ai-toggle${expanded ? " is-expanded" : ""}`}
          type="button"
          aria-label={toggleLabel}
          aria-expanded={expanded}
          aria-controls={aiPaneId}
          title={toggleLabel}
          onClick={toggleAi}
        >
          {expanded ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}
        </button>
      </header>
      <div className="task-workspace-layout" ref={layoutRef}>
        <div className="task-workspace-local-pane" id={localPaneId}>{local}</div>
        <div
          id={aiPaneId}
          ref={aiPaneRef}
          className="task-workspace-ai-pane"
          aria-hidden={!expanded}
          inert={!expanded}
        >
          {ai}
        </div>
        <div
          ref={separatorRef}
          className="task-workspace-separator"
          role="separator"
          aria-label={t("workspace.resize")}
          aria-orientation="vertical"
          aria-controls={localPaneId}
          aria-valuemin={percent(split.minimum)}
          aria-valuemax={percent(split.maximum)}
          aria-valuenow={percent(split.local)}
          aria-valuetext={t("workspace.localWidth", { percent: percent(split.local) })}
          aria-disabled={!split.resizable}
          tabIndex={expanded && split.resizable ? 0 : -1}
          hidden={!expanded}
          onPointerDown={startDrag}
          onPointerMove={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) moveDivider(event.clientX, dragRef.current.offset);
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              moveDivider(event.clientX, dragRef.current.offset);
              endDrag();
            }
          }}
          onPointerCancel={(event) => { if (dragRef.current?.pointerId === event.pointerId) endDrag(); }}
          onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) endDrag(); }}
          onBlur={() => endDrag()}
          onKeyDown={resizeWithKeyboard}
        />
      </div>
    </div>
  );
}
