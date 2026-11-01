import { Ellipsis, FileText, Pin } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { HistoryListItem } from "../../historyClient";
import { getHistoryTitle } from "./shellNavigation";

export type SidebarNoteSection = "pinned" | "notes";

type SidebarNoteRowProps = {
  item: HistoryListItem;
  section: SidebarNoteSection;
  active: boolean;
  navigationDisabled: boolean;
  disabledReason: string;
  guardReasonId: string;
  menuOpen: boolean;
  onOpenTask: (item: HistoryListItem) => void;
  onOpenMenu: (item: HistoryListItem, anchor: HTMLButtonElement, section: SidebarNoteSection) => void;
};

export function SidebarNoteRow({ item, section, active, navigationDisabled, disabledReason, guardReasonId, menuOpen, onOpenTask, onOpenMenu }: SidebarNoteRowProps) {
  const { t } = useTranslation("shell");
  const id = useId();
  const triggerId = `${id}-note-actions`;
  const title = getHistoryTitle(item);
  const Icon = section === "pinned" ? Pin : FileText;

  return (
    <li className={`shell-sidebar-note-row${active ? " is-active" : ""}`}>
      <button
        type="button"
        className={`shell-history-note${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        disabled={navigationDisabled}
        aria-describedby={navigationDisabled ? guardReasonId : undefined}
        title={navigationDisabled ? disabledReason : title}
        onClick={() => onOpenTask(item)}
      >
        <Icon size={15} aria-hidden="true" strokeWidth={1.6} />
        <span>{title}</span>
      </button>
      <button
        id={triggerId}
        type="button"
        className="shell-note-menu-trigger"
        aria-label={t("noteMenu.open", { title })}
        title={t("noteMenu.open", { title })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? `${triggerId}-menu` : undefined}
        data-note-menu-task={item.taskId}
        data-note-menu-section={section}
        onClick={(event) => onOpenMenu(item, event.currentTarget, section)}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
    </li>
  );
}
