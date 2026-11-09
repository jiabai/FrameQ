export const noteActionsResources = {
  "zh-CN": {
    common: { close: "关闭笔记面板", save: "保存", cancel: "取消", refresh: "刷新", done: "完成", saving: "正在保存…" },
    rename: {
      title: "重命名笔记", name: "笔记名称", hint: "最多 60 个字符，不能包含换行或控制字符。",
      invalid: "请输入有效的笔记名称，最多 60 个字符，且不能包含换行或控制字符。", count: "{{count}} / 60",
    },
    collections: {
      title: "添加到合集", description: "选择这篇笔记所属的合集。每次修改都会保存在本机。",
      loading: "正在读取合集…", empty: "暂无合集。请先在合集页面新建合集。",
    },
    info: {
      title: "笔记信息", loading: "正在读取笔记信息…", unavailable: "暂时无法读取此笔记的信息，请刷新重试。",
      fields: { title: "名称", titleOrigin: "名称来源", createdAt: "创建时间", sourceType: "来源类型", source: "来源", status: "处理状态", titleStatus: "标题状态", transcriptLanguage: "文字稿语言", transcriptEngine: "识别引擎", collections: "所属合集", artifacts: "已有作品", taskId: "任务编号" },
      origins: { manual: "手动命名", generated: "AI 生成", fallback: "文字稿或来源名称" },
      sourceTypes: { url: "视频链接", video: "本地视频", audio: "本地音频" },
      statuses: { completed: "已完成", partial_completed: "部分完成", failed: "失败" },
      titleStatuses: { generating: "正在生成", completed: "已完成", failed: "失败", cancelled: "已取消" },
    },
    notice: {
      metadataLoadFailed: "无法读取此笔记的本地设置。已保存的笔记仍可查看，固定和重命名暂不可用。",
      operationFailed: "笔记操作未能完成，请重试。", copied: "来源链接已复制。", sourceOpened: "来源已打开。",
      unavailable: "此笔记已不可用，请刷新后重试。", blocked: "请先保存编辑，并等待当前操作完成或确认取消后再试。",
      cleanupPending: "笔记已移除，部分本地文件仍待清理。可以重试清理，或重启 {{product}} 后继续。",
      cleanupFailed: "无法检查或继续清理本地文件，请重试清理。",
    },
    actions: { retryCleanup: "重试清理" },
  },
  "zh-TW": {
    common: { close: "關閉筆記面板", save: "儲存", cancel: "取消", refresh: "重新整理", done: "完成", saving: "正在儲存…" },
    rename: {
      title: "重新命名筆記", name: "筆記名稱", hint: "最多 60 個字元，不能包含換行或控制字元。",
      invalid: "請輸入有效的筆記名稱，最多 60 個字元，且不能包含換行或控制字元。", count: "{{count}} / 60",
    },
    collections: {
      title: "加入合集", description: "選擇這則筆記所屬的合集。每次修改都會儲存在本機。",
      loading: "正在讀取合集…", empty: "目前沒有合集。請先在合集頁面新增合集。",
    },
    info: {
      title: "筆記資訊", loading: "正在讀取筆記資訊…", unavailable: "暫時無法讀取此筆記的資訊，請重新整理後再試。",
      fields: { title: "名稱", titleOrigin: "名稱來源", createdAt: "建立時間", sourceType: "來源類型", source: "來源", status: "處理狀態", titleStatus: "標題狀態", transcriptLanguage: "逐字稿語言", transcriptEngine: "辨識引擎", collections: "所屬合集", artifacts: "已有作品", taskId: "任務編號" },
      origins: { manual: "手動命名", generated: "AI 產生", fallback: "逐字稿或來源名稱" },
      sourceTypes: { url: "影片連結", video: "本機影片", audio: "本機音訊" },
      statuses: { completed: "已完成", partial_completed: "部分完成", failed: "失敗" },
      titleStatuses: { generating: "正在產生", completed: "已完成", failed: "失敗", cancelled: "已取消" },
    },
    notice: {
      metadataLoadFailed: "無法讀取此筆記的本機設定。已儲存的筆記仍可檢視，固定與重新命名暫時無法使用。",
      operationFailed: "筆記操作未能完成，請再試一次。", copied: "來源連結已複製。", sourceOpened: "來源已開啟。",
      unavailable: "此筆記已無法使用，請重新整理後再試。", blocked: "請先儲存編輯，並等待目前操作完成或確認取消後再試。",
      cleanupPending: "筆記已移除，部分本機檔案仍待清理。可以重試清理，或重新啟動 {{product}} 後繼續。",
      cleanupFailed: "無法檢查或繼續清理本機檔案，請重試清理。",
    },
    actions: { retryCleanup: "重試清理" },
  },
  "en-US": {
    common: { close: "Close note panel", save: "Save", cancel: "Cancel", refresh: "Refresh", done: "Done", saving: "Saving…" },
    rename: {
      title: "Rename note", name: "Note name", hint: "Up to 60 characters, without line breaks or control characters.",
      invalid: "Enter a valid note name with up to 60 characters and no line breaks or control characters.", count: "{{count}} / 60",
    },
    collections: {
      title: "Add to Collection", description: "Choose the Collections for this note. Each change is saved on this device.",
      loading: "Loading Collection…", empty: "No Collection is available. Create one on the Collection page first.",
    },
    info: {
      title: "Note information", loading: "Loading note information…", unavailable: "This note's information could not be read. Refresh and try again.",
      fields: { title: "Name", titleOrigin: "Name origin", createdAt: "Created", sourceType: "Source type", source: "Source", status: "Processing status", titleStatus: "Title status", transcriptLanguage: "Transcript language", transcriptEngine: "Recognition engine", collections: "Collection", artifacts: "Available artifacts", taskId: "Task ID" },
      origins: { manual: "Manual name", generated: "AI generated", fallback: "Transcript or source name" },
      sourceTypes: { url: "Video link", video: "Local video", audio: "Local audio" },
      statuses: { completed: "Completed", partial_completed: "Partially completed", failed: "Failed" },
      titleStatuses: { generating: "Generating", completed: "Completed", failed: "Failed", cancelled: "Cancelled" },
    },
    notice: {
      metadataLoadFailed: "This note's local settings could not be read. The saved note is still available, while pinning and renaming are unavailable.",
      operationFailed: "The note operation could not be completed. Try again.", copied: "Source link copied.", sourceOpened: "Source opened.",
      unavailable: "This note is unavailable. Refresh and try again.", blocked: "Save your edits and wait for the current operation to finish or confirm cancellation before trying again.",
      cleanupPending: "The note was removed, but some local files still need cleanup. Retry cleanup or restart {{product}} to continue.",
      cleanupFailed: "Local file cleanup could not be inspected or continued. Retry cleanup.",
    },
    actions: { retryCleanup: "Retry cleanup" },
  },
} as const;
