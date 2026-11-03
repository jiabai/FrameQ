// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance, type Resource } from "i18next";
import { useState, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "vitest";

import type { SupportedLocale } from "../../i18n/locale";
import { workflowResources } from "../../i18n/workflowResources";
import type { TaskComposerSource, TaskSubmission } from "../../workflow";
import { TaskComposer } from "./TaskComposer";

function unexpectedAction(): never {
  throw new Error("Unexpected user action");
}

const selectedAudio = {
  kind: "local_media",
  retainedUrlDraft: "https://www.bilibili.com/video/BV1xx411c7mD",
  selection: {
    selectionToken: "01234567-89ab-4def-8abc-0123456789ab",
    displayName: "Interview.mp3",
    mediaKind: "audio",
    extension: "mp3",
    sizeBytes: 1_572_864,
  },
} as const satisfies TaskComposerSource;

function composerProps(
  overrides: Partial<ComponentProps<typeof TaskComposer>> = {},
): ComponentProps<typeof TaskComposer> {
  return {
    source: { kind: "url", urlDraft: "https://www.bilibili.com/video/BV1xx411c7mD" },
    canSubmit: true,
    statusBody: "Ready",
    onUrlDraftChange: unexpectedAction,
    onLocalMediaSelected: unexpectedAction,
    onRemoveLocalMedia: unexpectedAction,
    onSubmit: unexpectedAction,
    ...overrides,
  };
}

async function localized(ui: ReactElement, locale: SupportedLocale = "en-US") {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    resources: { [locale]: { workflow: workflowResources[locale] } } as Resource,
    interpolation: { escapeValue: false },
  });
  return <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;
}

afterEach(cleanup);

describe("TaskComposer", () => {
  test.each(["zh-CN", "zh-TW", "en-US"] as const)("omits the automatic title disclosure from the home composer in %s", async (locale) => {
    render(await localized(<TaskComposer {...composerProps()} />, locale));
    expect(screen.queryByText(workflowResources[locale].noteTitle.disclosure)).toBeNull();
    const submit = screen.getByRole("button", { name: workflowResources[locale].input.confirm });
    expect(submit.hasAttribute("aria-describedby")).toBe(false);
    const description = screen.getByRole("textbox").getAttribute("aria-describedby");
    expect(description).toBeTruthy();
    expect(document.getElementById(description!)).toBeTruthy();
  });

  test("renders a direct file chooser and retains the accessible URL input", async () => {
    render(await localized(<TaskComposer {...composerProps()} />));

    const chooseFiles = screen.getByRole("button", { name: "Add local media" });
    expect(chooseFiles.textContent).toContain("Choose files");
    expect(chooseFiles.getAttribute("type")).toBe("button");
    expect(chooseFiles.hasAttribute("aria-haspopup")).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    const input = screen.getByRole("textbox", { name: "Video or web page URL" }) as HTMLInputElement;
    expect(input.id).toBe("video-url");
    expect(input.value).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
  });

  test.each([
    ["zh-CN", "选择文件", "录制语音", "语音录制暂不可用。"],
    ["zh-TW", "選擇檔案", "錄製語音", "語音錄製目前無法使用。"],
    ["en-US", "Choose files", "Record voice", "Voice recording is currently unavailable."],
  ] as const)(
    "explains supported sources and disabled recording in %s",
    async (locale, files, record, reason) => {
      render(await localized(
        <TaskComposer {...composerProps({
          source: { kind: "url", urlDraft: "" },
          canSubmit: false,
        })} />,
        locale,
      ));

      expect(screen.getByText(files)).toBeTruthy();
      const recording = screen.getByRole("button", { name: record }) as HTMLButtonElement;
      expect(recording.disabled).toBe(true);
      expect(recording.title).toBe(reason);
      expect(document.getElementById(recording.getAttribute("aria-describedby")!)?.textContent).toBe(reason);
      expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBeTruthy();
      expect(screen.queryByRole("button", { name: workflowResources[locale].input.confirm })).toBeNull();
      expect(document.body.textContent).not.toMatch(/Markdown|50\s?MB|拖放|拖曳|drag|images/i);
    },
  );

  test("expands without changing the draft and Escape restores the expand button focus", async () => {
    render(await localized(<TaskComposer {...composerProps()} />));
    const expand = screen.getByRole("button", { name: "Expand composer" });
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse composer" })).toBe(expand);
    expect(input.value).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(expand);
  });

  test("collapses through its keyboard-accessible button", async () => {
    render(await localized(<TaskComposer {...composerProps()} />));
    fireEvent.click(screen.getByRole("button", { name: "Expand composer" }));
    const collapse = screen.getByRole("button", { name: "Collapse composer" });
    fireEvent.click(collapse);
    expect(collapse.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(collapse);
  });

  test("edits the real controlled URL and submits explicitly", async () => {
    const submissions: TaskSubmission[] = [];
    function ComposerWithDraft() {
      const [urlDraft, setUrlDraft] = useState("");
      return <TaskComposer {...composerProps({
        source: { kind: "url", urlDraft },
        canSubmit: urlDraft.length > 0,
        onUrlDraftChange: setUrlDraft,
        onSubmit: (submission) => submissions.push(submission),
      })} />;
    }
    render(await localized(<ComposerWithDraft />));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "https://www.bilibili.com/video/BV1xx411c7mD" },
    });
    expect(submissions).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(submissions).toEqual([{ kind: "url", url: "https://www.bilibili.com/video/BV1xx411c7mD" }]);
  });

  test("guards form submission when the current source cannot submit", async () => {
    const submissions: TaskSubmission[] = [];
    render(await localized(<TaskComposer {...composerProps({
      canSubmit: false,
      onSubmit: (submission) => submissions.push(submission),
    })} />));
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(submissions).toEqual([]);
    const confirm = screen.queryByRole("button", { name: "Confirm" }) as HTMLButtonElement | null;
    expect(confirm === null || confirm.disabled).toBe(true);
  });

  test("renders safe audio details and submits only the selection token", async () => {
    const submissions: TaskSubmission[] = [];
    const props = composerProps({ source: selectedAudio, onSubmit: (submission) => submissions.push(submission) });
    const markup = renderToStaticMarkup(await localized(<TaskComposer {...props} />));
    expect(markup).toContain('data-media-kind="audio"');
    expect(markup).toContain("Interview.mp3");
    expect(markup).toContain("Audio");
    expect(markup).toContain("1.5 MB");
    expect(markup).not.toContain("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(markup).not.toContain("selectionToken");
    render(await localized(<TaskComposer {...props} />));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(submissions).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(submissions).toEqual([{ kind: "local_media", selectionToken: selectedAudio.selection.selectionToken }]);
  });

  test("removes a selected file, restores the retained URL, and focuses the chooser", async () => {
    function ComposerWithSelection() {
      const [source, setSource] = useState<TaskComposerSource>(selectedAudio);
      return <TaskComposer {...composerProps({
        source,
        onRemoveLocalMedia: async () => {
          setSource({ kind: "url", urlDraft: selectedAudio.retainedUrlDraft });
          return true;
        },
      })} />;
    }
    render(await localized(<ComposerWithSelection />));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected file: Interview.mp3" }));
    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(selectedAudio.retainedUrlDraft);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add local media" }));
    });
  });

  test("keeps the selection and restores remove focus when removal is refused", async () => {
    render(await localized(<TaskComposer {...composerProps({
      source: selectedAudio,
      onRemoveLocalMedia: async () => false,
    })} />));
    const remove = screen.getByRole("button", { name: "Remove selected file: Interview.mp3" });
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not remove the selected file. Try again."));
    expect(document.activeElement).toBe(remove);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("reports the unavailable native picker without submitting in a browser environment", async () => {
    const submissions: TaskSubmission[] = [];
    render(await localized(<TaskComposer {...composerProps({
      onSubmit: (submission) => submissions.push(submission),
    })} />));
    const chooseFiles = screen.getByRole("button", { name: "Add local media" });
    fireEvent.click(chooseFiles);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not select local media. Try again."));
    expect(document.activeElement).toBe(chooseFiles);
    expect(submissions).toEqual([]);
  });
});
