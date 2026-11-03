import type { HistoryListItem } from "../../historyClient";
import type { TaskArtifactKey, TaskArtifacts } from "../../workflowState";

export type ShellPage = "home" | "notes" | "collections" | "artifacts" | "task";

export type ShellNavigationEntry = {
  page: ShellPage;
  taskId: string | null;
  collectionId?: string | null;
};

export type ShellNavigationState = {
  entries: ShellNavigationEntry[];
  index: number;
};

export type ShellNavigationAction =
  | { type: "navigate" | "replace"; page: ShellPage; taskId?: string | null; collectionId?: string | null; canNavigate: boolean }
  | { type: "back" | "forward"; canNavigate: boolean };

export type ShellNavigationBlockers = {
  processing: boolean;
  submissionPending?: boolean;
  modelDownloadActive: boolean;
  transcriptSaving: boolean;
  transcriptDirty: boolean;
  draftSaving?: boolean;
  draftDirty?: boolean;
};

export function createShellNavigation(
  initialPage: ShellPage = "home",
  taskId: string | null = null,
  collectionId: string | null = null,
): ShellNavigationState {
  return {
    entries: [createNavigationEntry(initialPage, taskId, collectionId)],
    index: 0,
  };
}

export function getShellPage(state: ShellNavigationState): ShellPage {
  return state.entries[state.index].page;
}

export function getShellTaskId(state: ShellNavigationState): string | null {
  return state.entries[state.index].taskId;
}

export function getShellCollectionId(state: ShellNavigationState): string | null {
  const entry = state.entries[state.index];
  return entry.page === "collections" ? entry.collectionId ?? null : null;
}

function createNavigationEntry(
  page: ShellPage,
  taskId: string | null = null,
  collectionId: string | null = null,
): ShellNavigationEntry {
  return page === "collections"
    ? { page, taskId: null, collectionId }
    : { page, taskId: page === "task" ? taskId : null };
}

function sameDestination(first: ShellNavigationEntry, second: ShellNavigationEntry): boolean {
  return first.page === second.page && first.taskId === second.taskId &&
    (first.collectionId ?? null) === (second.collectionId ?? null);
}

export function shellNavigationReducer(
  state: ShellNavigationState,
  action: ShellNavigationAction,
): ShellNavigationState {
  if (!action.canNavigate) {
    return state;
  }
  if (action.type === "navigate" || action.type === "replace") {
    const entry = createNavigationEntry(action.page, action.taskId ?? null, action.collectionId ?? null);
    if (sameDestination(state.entries[state.index], entry)) {
      return state;
    }
    if (action.type === "replace") {
      const entries = [...state.entries];
      entries[state.index] = entry;
      return { ...state, entries };
    }
    const entries = [...state.entries.slice(0, state.index + 1), entry];
    return { entries, index: entries.length - 1 };
  }
  const index = state.index + (action.type === "back" ? -1 : 1);
  return index < 0 || index >= state.entries.length ? state : { ...state, index };
}

export function canNavigateShell(blockers: ShellNavigationBlockers): boolean {
  return !(
    blockers.processing ||
    blockers.submissionPending ||
    blockers.modelDownloadActive ||
    blockers.transcriptSaving ||
    blockers.transcriptDirty ||
    blockers.draftSaving ||
    blockers.draftDirty
  );
}

export function removeShellTask(
  state: ShellNavigationState,
  taskId: string,
): ShellNavigationState {
  return removeShellVisits(
    state,
    (entry) => entry.page === "task" && entry.taskId === taskId,
    createNavigationEntry("home"),
  );
}

export function removeShellCollection(
  state: ShellNavigationState,
  collectionId: string,
): ShellNavigationState {
  return removeShellVisits(
    state,
    (entry) => entry.page === "collections" && entry.collectionId === collectionId,
    createNavigationEntry("collections"),
  );
}

export function pruneUnavailableShellTasks(
  state: ShellNavigationState,
  availableIds: ReadonlySet<string>,
): ShellNavigationState {
  return removeShellVisits(
    state,
    (entry, index) => entry.page === "task" && (
      entry.taskId === null ? index !== state.index : !availableIds.has(entry.taskId)
    ),
    createNavigationEntry("home"),
  );
}

function removeShellVisits(
  state: ShellNavigationState,
  isDeleted: (entry: ShellNavigationEntry, index: number) => boolean,
  replacement: ShellNavigationEntry,
): ShellNavigationState {
  if (!state.entries.some(isDeleted)) {
    return state;
  }
  const entries: ShellNavigationEntry[] = [];
  let index = 0;
  state.entries.forEach((entry, entryIndex) => {
    const deleted = isDeleted(entry, entryIndex);
    if (deleted && entryIndex !== state.index) {
      return;
    }
    const retained = deleted ? replacement : entry;
    const previous = entries[entries.length - 1];
    if (!previous || !sameDestination(previous, retained)) {
      entries.push(retained);
    }
    if (entryIndex === state.index) {
      index = entries.length - 1;
    }
  });
  return { entries, index };
}

export function getHistoryTitle(
  item: Pick<HistoryListItem, "taskId" | "source" | "textPreview" | "noteTitle" | "noteMetadata">,
): string {
  if (item.noteMetadata?.displayTitle) return item.noteMetadata.displayTitle;
  if (item.source.kind === "web_page") return item.source.title;
  if (item.noteTitle?.text) return item.noteTitle.text;
  const preview = item.textPreview.replace(/\s+/gu, " ").trim();
  if (preview) {
    return preview;
  }
  if (item.source.kind === "local_file") {
    return item.source.displayName;
  }
  if (!URL.canParse(item.source.url)) {
    return item.taskId;
  }
  const sourceUrl = new URL(item.source.url);
  if (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") {
    return item.taskId;
  }
  return `${sourceUrl.host}${sourceUrl.pathname === "/" ? "" : sourceUrl.pathname}`;
}

const USER_ARTIFACT_KEYS = [
  "video", "audio", "transcript_txt", "transcript_md", "article_txt", "article_md", "summary", "mindmap",
  "insights", "insights_md", "dissection", "dissection_md", "draft",
] as const satisfies readonly TaskArtifactKey[];

export function getVisibleArtifactKeys(artifacts: TaskArtifacts): TaskArtifactKey[] {
  return USER_ARTIFACT_KEYS.filter((key) => Boolean(artifacts[key]?.trim()));
}
