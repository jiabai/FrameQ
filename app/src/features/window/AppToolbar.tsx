import { Download, History as HistoryIcon, LoaderCircle, RotateCcw, Settings, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useWindowChromeController } from "./useWindowChromeController";

export type AppToolbarUpdateState = {
  visible: boolean;
  status: string;
  text: string;
  busy: boolean;
  spinnerVisible: boolean;
};

export type AppToolbarNewTaskState = {
  disabled: boolean;
  ariaLabel: string;
  title: string;
};

type AppToolbarProps = {
  accountChipLabel: string;
  accountActive: boolean;
  update: AppToolbarUpdateState;
  newTask: AppToolbarNewTaskState;
  onOpenAccount: () => void;
  onInstallUpdate: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onNewTask: () => void;
};

export function AppToolbar({
  accountChipLabel,
  accountActive,
  update,
  newTask,
  onOpenAccount,
  onInstallUpdate,
  onOpenHistory,
  onOpenSettings,
  onNewTask,
}: AppToolbarProps) {
  const { t } = useTranslation("common");
  const {
    handleToolbarMouseDown,
    closeWindow,
    minimizeWindow,
    toggleMaximizeWindow,
  } = useWindowChromeController();

  return (
    <header className="app-toolbar topbar" data-tauri-drag-region="" onMouseDown={handleToolbarMouseDown}>
      <div className="traffic-lights" role="group" aria-label={t("window.controls")}>
        <button
          className="traffic-light close"
          type="button"
          aria-label={t("window.close")}
          onClick={closeWindow}
        />
        <button
          className="traffic-light minimize"
          type="button"
          aria-label={t("window.minimize")}
          onClick={minimizeWindow}
        />
        <button
          className="traffic-light zoom"
          type="button"
          aria-label={t("window.maximize")}
          onClick={toggleMaximizeWindow}
        />
      </div>

      <div className="toolbar-title" data-tauri-drag-region="">
        <span className="app-mark" data-tauri-drag-region="">{t("appMark")}</span>
        <div data-tauri-drag-region="">
          <h1 data-tauri-drag-region="">{t("productName")}</h1>
        </div>
      </div>

      <div className="topbar-actions toolbar-actions">
        <button
          className={`account-chip ${accountActive ? "active" : ""}`}
          type="button"
          onClick={onOpenAccount}
          aria-label={t("toolbar.account")}
        >
          <UserRound size={15} />
          <span>{accountChipLabel}</span>
        </button>
        {update.visible ? (
          <button
            className={`update-chip ${update.status}`}
            type="button"
            onClick={onInstallUpdate}
            aria-label={t("toolbar.update")}
            disabled={update.busy}
          >
            {update.spinnerVisible ? <LoaderCircle size={15} /> : <Download size={15} />}
            <span>{update.text}</span>
          </button>
        ) : null}
        <div className="toolbar-tool-group" role="group" aria-label={t("toolbar.taskTools")}>
          <button className="icon-button" type="button" onClick={onOpenHistory} aria-label={t("toolbar.history")}>
            <HistoryIcon size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onOpenSettings} aria-label={t("toolbar.settings")}>
            <Settings size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onNewTask}
            aria-label={newTask.ariaLabel}
            title={newTask.title}
            disabled={newTask.disabled}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
