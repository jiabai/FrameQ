import {
  ArrowDownWideNarrow,
  ChevronDown,
  ChevronsUpDown,
  FileText,
  Folder,
  House,
  Layers3,
  Plus,
  RefreshCw,
  Settings,
  UserRound,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { AccountStatus } from "../../accountState";
import type { Collection } from "../../collectionsClient";
import type { HistoryListItem } from "../../historyClient";
import { useUiLocale } from "../../i18n/LocaleProvider";
import { getCollectionTaskCount } from "../collections/collectionModel";
import { FrameQMark } from "./FrameQMark";
import type { ShellPage } from "./shellNavigation";
import { SidebarNoteRow, type SidebarNoteSection } from "./SidebarNoteRow";

type DesktopSidebarProps = {
  page: ShellPage;
  collapsed: boolean;
  historyItems: readonly HistoryListItem[];
  historyLoading: boolean;
  historyNotice: string | null;
  collections: readonly Collection[];
  collectionsLoading: boolean;
  collectionsNotice: string | null;
  selectedCollectionId: string | null;
  currentTaskId: string | null;
  navigationDisabled: boolean;
  disabledReason: string;
  newTaskDisabled: boolean;
  account: AccountStatus;
  onNavigate: (page: ShellPage) => void;
  onOpenTask: (item: HistoryListItem) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onRefresh: () => void;
  onOpenCollection: (id: string) => void;
  onCreateCollection: () => void;
  onOpenNoteMenu: (item: HistoryListItem, anchor: HTMLButtonElement, section: SidebarNoteSection) => void;
  activeNoteMenu?: { taskId: string; section: SidebarNoteSection } | null;
};

const destinations = [
  { page: "home", icon: House },
  { page: "notes", icon: FileText },
  { page: "collections", icon: Folder },
  { page: "artifacts", icon: Layers3 },
] as const;

export function DesktopSidebar({
  page,
  collapsed,
  historyItems,
  historyLoading,
  historyNotice,
  collections,
  collectionsLoading,
  collectionsNotice,
  selectedCollectionId,
  currentTaskId,
  navigationDisabled,
  disabledReason,
  newTaskDisabled,
  account,
  onNavigate,
  onOpenTask,
  onNewTask,
  onOpenSettings,
  onOpenAccount,
  onRefresh,
  onOpenCollection,
  onCreateCollection,
  onOpenNoteMenu,
  activeNoteMenu = null,
}: DesktopSidebarProps) {
  const { t } = useTranslation("shell");
  const { t: commonT } = useTranslation("common");
  const locale = useUiLocale();
  const id = useId();
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [collectionSort, setCollectionSort] = useState<"saved" | "ascending" | "descending">("saved");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialMenuFocusRef = useRef<"first" | "last">("first");
  const notesId = `${id}-notes`;
  const pinnedId = `${id}-pinned`;
  const collectionsId = `${id}-collections`;
  const menuId = `${id}-account-menu`;
  const guardReasonId = `${id}-guard-reason`;
  const email = account.authenticated ? account.email : null;
  const displayName = email ? email.split("@")[0] : t("account.guest");
  const sortedItems = [...historyItems].sort((left, right) => {
    const order = left.createdAt.localeCompare(right.createdAt);
    return (oldestFirst ? order : -order) || (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
  });
  const pinnedItems = sortedItems.filter((item) => !item.noteMetadataError && item.noteMetadata?.pinned);
  const sortedCollections = [...collections];
  if (collectionSort !== "saved") {
    sortedCollections.sort((left, right) => {
      const order = left.name.localeCompare(right.name, locale);
      return collectionSort === "ascending" ? order : -order;
    });
  }

  useEffect(() => {
    if (!accountMenuOpen) return;
    const menuItems = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    const focusIndex = initialMenuFocusRef.current === "last" ? (menuItems?.length ?? 1) - 1 : 0;
    menuItems?.[focusIndex]?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [accountMenuOpen]);

  function closeMenu(restoreFocus: boolean) {
    setAccountMenuOpen(false);
    if (restoreFocus) accountTriggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu(false);
      return;
    }
    const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? menuItems.length - 1
      : event.key === "ArrowDown" ? (currentIndex + 1) % menuItems.length
      : event.key === "ArrowUp" ? (currentIndex - 1 + menuItems.length) % menuItems.length
      : null;
    if (nextIndex !== null) {
      event.preventDefault();
      menuItems[nextIndex]?.focus();
    }
  }

  return (
    <aside className={`desktop-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="shell-sidebar-brand" aria-label={commonT("appName")}>
        <FrameQMark className="shell-sidebar-mark" />
        <span className="shell-sidebar-label">{commonT("appName")}</span>
      </div>

      <nav className="shell-sidebar-nav" aria-label={t("nav.ariaLabel")}>
        {destinations.map(({ page: destination, icon: Icon }) => {
          const reason = navigationDisabled ? disabledReason : undefined;
          return (
            <button
              className={`shell-nav-item${page === destination ? " is-active" : ""}`}
              data-shell-destination={destination}
              type="button"
              key={destination}
              aria-label={t(`nav.${destination}`)}
              aria-current={page === destination ? "page" : undefined}
              aria-describedby={navigationDisabled ? guardReasonId : undefined}
              disabled={navigationDisabled}
              title={reason ?? t(`nav.${destination}`)}
              onClick={() => onNavigate(destination)}
            >
              <Icon size={18} aria-hidden="true" strokeWidth={1.75} />
              <span className="shell-sidebar-label">{t(`nav.${destination}`)}</span>
            </button>
          );
        })}
      </nav>

      {navigationDisabled || newTaskDisabled ? <p className="shell-visually-hidden" id={guardReasonId}>{disabledReason}</p> : null}

      <div className="shell-sidebar-history">
        <section className="shell-history-group">
          <div className="shell-history-heading">
            <button
              type="button"
              className="shell-history-toggle"
              aria-label={t(collectionsExpanded ? "sidebar.collapseCollections" : "sidebar.expandCollections")}
              aria-expanded={collectionsExpanded}
              aria-controls={collectionsId}
              onClick={() => setCollectionsExpanded(!collectionsExpanded)}
            >
              <ChevronDown className={collectionsExpanded ? "" : "is-folded"} size={13} aria-hidden="true" />
              <span>{t("nav.collections")}</span>
            </button>
            <button
              type="button"
              className="shell-small-button"
              onClick={() => setCollectionSort(collectionSort === "ascending" ? "descending" : "ascending")}
              title={t(collectionSort === "ascending" ? "sidebar.sortCollectionsDescending" : "sidebar.sortCollectionsAscending")}
              aria-label={t(collectionSort === "ascending" ? "sidebar.sortCollectionsDescending" : "sidebar.sortCollectionsAscending")}
            >
              <ArrowDownWideNarrow size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="shell-small-button"
              disabled={navigationDisabled || collectionsLoading}
              onClick={onCreateCollection}
              title={navigationDisabled ? disabledReason : t("sidebar.addCollection")}
              aria-label={t("sidebar.addCollection")}
              aria-describedby={navigationDisabled ? guardReasonId : undefined}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
          <div id={collectionsId} hidden={!collectionsExpanded}>
            {collectionsLoading && !collectionsNotice ? <p className="shell-sidebar-hint" role="status">{t("sidebar.collectionsLoading")}</p> : null}
            {collectionsNotice ? <p className="shell-sidebar-hint" role="status">{collectionsNotice}</p> : null}
            {!collectionsLoading && !collectionsNotice && collections.length === 0 ? <p className="shell-sidebar-hint">{t("sidebar.emptyCollections")}</p> : null}
            {sortedCollections.length > 0 ? (
              <ul className="shell-sidebar-notes shell-sidebar-collections" aria-label={t("nav.collections")}>
                {sortedCollections.map((collection) => (
                  <li key={collection.id}>
                    <button
                      type="button"
                      className={`shell-history-note${page === "collections" && selectedCollectionId === collection.id ? " is-active" : ""}`}
                      aria-label={t("sidebar.collectionCount", { name: collection.name, count: getCollectionTaskCount(collection, historyItems) })}
                      aria-current={page === "collections" && selectedCollectionId === collection.id ? "page" : undefined}
                      disabled={navigationDisabled}
                      aria-describedby={navigationDisabled ? guardReasonId : undefined}
                      title={navigationDisabled ? disabledReason : collection.name}
                      onClick={() => onOpenCollection(collection.id)}
                    >
                      <Folder size={15} aria-hidden="true" strokeWidth={1.6} />
                      <span>{collection.name}</span>
                      <small className="shell-collection-count">{getCollectionTaskCount(collection, historyItems)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        {pinnedItems.length > 0 ? (
          <section className="shell-history-group shell-pinned-group">
            <div className="shell-history-heading">
              <button
                type="button"
                className="shell-history-toggle"
                aria-label={t(pinnedExpanded ? "sidebar.collapsePinned" : "sidebar.expandPinned")}
                aria-expanded={pinnedExpanded}
                aria-controls={pinnedId}
                onClick={() => setPinnedExpanded(!pinnedExpanded)}
              >
                <ChevronDown className={pinnedExpanded ? "" : "is-folded"} size={13} aria-hidden="true" />
                <span>{t("sidebar.pinned")}</span>
              </button>
            </div>
            <div id={pinnedId} hidden={!pinnedExpanded}>
              <ul className="shell-sidebar-notes" aria-label={t("sidebar.pinned")}>
                {pinnedItems.map((item) => (
                  <SidebarNoteRow
                    key={item.taskId}
                    item={item}
                    section="pinned"
                    active={page === "task" && currentTaskId === item.taskId}
                    navigationDisabled={navigationDisabled}
                    disabledReason={disabledReason}
                    guardReasonId={guardReasonId}
                    menuOpen={activeNoteMenu?.taskId === item.taskId && activeNoteMenu.section === "pinned"}
                    onOpenTask={onOpenTask}
                    onOpenMenu={onOpenNoteMenu}
                  />
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="shell-history-group shell-notes-group">
          <div className="shell-history-heading">
            <button
              type="button"
              className="shell-history-toggle"
              aria-label={t(notesExpanded ? "sidebar.collapseNotes" : "sidebar.expandNotes")}
              aria-expanded={notesExpanded}
              aria-controls={notesId}
              onClick={() => setNotesExpanded(!notesExpanded)}
            >
              <ChevronDown className={notesExpanded ? "" : "is-folded"} size={13} aria-hidden="true" />
              <span>{t("sidebar.notes")}</span>
            </button>
            <button type="button" className="shell-small-button" onClick={onRefresh} disabled={historyLoading} title={t("sidebar.refresh")} aria-label={t("sidebar.refresh")}>
              <RefreshCw size={12} aria-hidden="true" className={historyLoading ? "spin" : undefined} />
            </button>
            <button
              type="button"
              className="shell-small-button"
              onClick={() => setOldestFirst(!oldestFirst)}
              title={t(oldestFirst ? "sidebar.sortNewest" : "sidebar.sortOldest")}
              aria-label={t(oldestFirst ? "sidebar.sortNewest" : "sidebar.sortOldest")}
            >
              <ArrowDownWideNarrow size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="shell-small-button"
              onClick={onNewTask}
              disabled={newTaskDisabled}
              title={newTaskDisabled ? disabledReason : t("sidebar.newTask")}
              aria-label={t("sidebar.newTask")}
              aria-describedby={newTaskDisabled ? guardReasonId : undefined}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
          <div id={notesId} hidden={!notesExpanded} className="shell-notes-content">
            {historyLoading && !historyNotice ? <p className="shell-sidebar-hint" role="status">{t("sidebar.loading")}</p> : null}
            {historyNotice ? <p className="shell-sidebar-hint" role="status">{historyNotice}</p> : null}
            {!historyLoading && !historyNotice && historyItems.length === 0 ? <p className="shell-sidebar-hint">{t("sidebar.empty")}</p> : null}
            {sortedItems.length > 0 ? (
              <ul className="shell-sidebar-notes" aria-label={t("nav.notes")}>
                {sortedItems.map((item) => (
                  <SidebarNoteRow
                    key={item.taskId}
                    item={item}
                    section="notes"
                    active={page === "task" && currentTaskId === item.taskId}
                    navigationDisabled={navigationDisabled}
                    disabledReason={disabledReason}
                    guardReasonId={guardReasonId}
                    menuOpen={activeNoteMenu?.taskId === item.taskId && activeNoteMenu.section === "notes"}
                    onOpenTask={onOpenTask}
                    onOpenMenu={onOpenNoteMenu}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>

      <div
        ref={accountRef}
        className="shell-sidebar-account"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setAccountMenuOpen(false);
        }}
      >
        {accountMenuOpen ? (
          <div className="shell-account-menu" ref={menuRef} id={menuId} role="menu" aria-label={t("account.menu")} onKeyDown={handleMenuKeyDown}>
            <button type="button" role="menuitem" onClick={() => { closeMenu(true); onOpenAccount(); }}>
              <UserRound size={16} aria-hidden="true" />{t("account.openAccount")}
            </button>
            <button type="button" role="menuitem" onClick={() => { closeMenu(true); onOpenSettings(); }}>
              <Settings size={16} aria-hidden="true" />{t("account.openSettings")}
            </button>
          </div>
        ) : null}
        <button
          ref={accountTriggerRef}
          className="shell-account-trigger"
          type="button"
          aria-label={t("account.menu")}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          aria-controls={accountMenuOpen ? menuId : undefined}
          title={email ?? t("account.guestDescription")}
          onClick={() => { initialMenuFocusRef.current = "first"; setAccountMenuOpen(!accountMenuOpen); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              initialMenuFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
              setAccountMenuOpen(true);
            }
          }}
        >
          <span className="shell-account-avatar" aria-hidden="true">{email ? displayName.slice(0, 1).toLocaleUpperCase() : <UserRound size={17} />}</span>
          <span className="shell-account-details shell-sidebar-label">
            <strong>{displayName}</strong>
            <span>{email ?? t("account.guestDescription")}</span>
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" className="shell-account-chevron shell-sidebar-label" />
        </button>
      </div>
    </aside>
  );
}
