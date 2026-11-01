import { describe, expect, test } from "vitest";

import { shellResources } from "./shellResources";

describe("Collection and Notes terminology", () => {
  test.each([
    ["zh-CN", "已固定", ["固定到侧边栏", "取消固定", "重命名", "添加到合集", "复制来源链接", "打开来源", "笔记信息", "直接删除"]],
    ["zh-TW", "已固定", ["固定到側邊欄", "取消固定", "重新命名", "加入合集", "複製來源連結", "開啟來源", "筆記資訊", "直接刪除"]],
    ["en-US", "Pinned", ["Pin to sidebar", "Unpin", "Rename", "Add to Collection", "Copy source link", "Open source", "Note information", "Delete permanently"]],
  ] as const)("provides the confirmed note menu and pinned glossary in %s", (locale, pinned, actions) => {
    const resource = shellResources[locale];
    const menu = resource.noteMenu;
    expect(resource.sidebar.pinned).toBe(pinned);
    expect(resource.sidebar.collapsePinned).toBeTruthy();
    expect(resource.sidebar.expandPinned).toBeTruthy();
    expect([menu.pin, menu.unpin, menu.rename, menu.collection, menu.copy_source, menu.open_source, menu.info, menu.delete]).toEqual(actions);
    expect(menu.label).toContain("{{title}}");
    expect(menu.open).toContain("{{title}}");
    expect(menu.metadataUnavailable).toBeTruthy();
    expect(menu.sourceUnavailable).toBeTruthy();
    expect(Object.keys(menu).sort()).toEqual(Object.keys(shellResources["en-US"].noteMenu).sort());
  });

  test.each([
    ["zh-CN", "笔记", "合集", "新建合集", "新建笔记", "添加笔记到合集"],
    ["zh-TW", "筆記", "合集", "新增合集", "新增筆記", "新增筆記到合集"],
    ["en-US", "Notes", "Collection", "New Collection", "New note", "Add notes to Collection"],
  ] as const)("uses the requested labels and actions in %s", (locale, notes, collection, create, newNote, addNotes) => {
    const resource = shellResources[locale];
    expect(resource.nav.notes).toBe(notes);
    expect(resource.sidebar.notes).toBe(notes);
    expect(resource.nav.collections).toBe(collection);
    expect(resource.collections.create).toBe(create);
    expect(resource.collections).toHaveProperty("newNote", newNote);
    expect(resource.collections).toHaveProperty("addNotesToCollection", addNotes);
    expect(resource.collections.renameCollection).toContain("{{name}}");
    expect(resource.collections.deleteCollection).toContain("{{name}}");
    expect(resource.collections.manageTasks).toBe(addNotes);
    expect(resource.collections.noteDestination).toBe(`${newNote} · {{name}}`);
    expect(JSON.stringify(Object.values(resource.collections))).not.toMatch(/收藏[集夹夾]|\bcollections\b|\btasks?\b|任务|任務/i);
    expect(resource.sidebar.collectionCount_other).toContain(locale === "en-US" ? "notes" : notes);
    expect(JSON.stringify(Object.values(resource.library))).not.toMatch(/\btasks?\b|任务|任務/i);
  });

  test.each([
    ["zh-CN", "笔记已保存，但未能加入合集。可以重试添加。", "重试添加"],
    ["zh-TW", "筆記已儲存，但未能加入合集。可以重試加入。", "重試加入"],
    ["en-US", "The note was saved, but could not be added to the Collection. You can retry adding it.", "Retry adding"],
  ] as const)("explains a saved note whose membership failed in %s", (locale, notice, retry) => {
    expect(shellResources[locale].collections.noteSavedMembershipFailed).toBe(notice);
    expect(shellResources[locale].collections.retryAddNote).toBe(retry);
  });
});
