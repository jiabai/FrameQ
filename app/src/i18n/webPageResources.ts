export const webPageResources = {
  "zh-CN": {
    title: "网页正文", locate: "定位正文", copy: "复制正文", copied: "正文已复制。", copyFailed: "无法复制正文。", empty: "保存网页后在这里阅读正文。", cancel: "取消", back: "返回格式化正文", source: "原始正文引用", complete: "网页正文已保存，可以阅读，也可以在工作间生成。",
    disclosure: "网页正文保存在本机。保存网页不会产生 AI Credit 费用，工作间在确认后计费。",
    currentText: "当前网页正文", privacy: "确认后，已保存的网页正文将发送到当前配置的 AI 服务进行处理。{{product}} 账号服务仅处理结账与额度。", unavailable: "网页正文尚未保存。", waiting: "请先保存网页正文。",
    extractedAt: "提取时间", originalTitle: "网页标题", sourceType: "网页",
    located: "已在文件管理器中定位正文。", locateFailed: "无法在文件管理器中定位正文。",
    dissection: { title: "正文解剖", confirmation: "确认解剖这份正文", close: "关闭正文解剖确认", characters: "正文字符数", tooLong: "当前正文超过最多 6 次调用的处理范围。", stale: "正文已变化，请重新解剖后定位。", locate: "定位到正文" },
    stages: { web_loading: "加载网页", web_extracting: "提取正文", web_saving: "保存笔记" },
  },
  "zh-TW": {
    title: "網頁正文", locate: "定位正文", copy: "複製正文", copied: "正文已複製。", copyFailed: "無法複製正文。", empty: "儲存網頁後在這裡閱讀正文。", cancel: "取消", back: "返回格式化正文", source: "原始正文引用", complete: "網頁正文已儲存，可以閱讀及在工作間產生。",
    disclosure: "網頁正文儲存在本機。儲存網頁不會產生 AI Credit 費用，工作間在確認後計費。",
    currentText: "目前網頁正文", privacy: "確認後，已儲存的網頁正文將傳送至目前設定的 AI 服務進行處理。{{product}} 帳號服務僅處理結帳與額度。", unavailable: "網頁正文尚未儲存。", waiting: "請先儲存網頁正文。",
    extractedAt: "擷取時間", originalTitle: "網頁標題", sourceType: "網頁",
    located: "已在檔案管理員中定位正文。", locateFailed: "無法在檔案管理員中定位正文。",
    dissection: { title: "正文解剖", confirmation: "確認解剖這份正文", close: "關閉正文解剖確認", characters: "正文字元數", tooLong: "目前正文超過最多 6 次呼叫的處理範圍。", stale: "正文已變更，請重新解剖後定位。", locate: "定位到正文" },
    stages: { web_loading: "載入網頁", web_extracting: "擷取正文", web_saving: "儲存筆記" },
  },
  "en-US": {
    title: "Web article", locate: "Show article in folder", copy: "Copy article", copied: "Article copied.", copyFailed: "Could not copy the article.", empty: "Save a web page to read its article here.", cancel: "Cancel", back: "Return to formatted article", source: "Original article excerpt", complete: "The web article is saved and ready for reading and AI generation.",
    disclosure: "Web articles are saved locally. Saving a page costs no AI Credits. AI generation is billed after confirmation.",
    currentText: "Current web article", privacy: "After confirmation, the saved article is sent to your configured AI provider for processing. The {{product}} account service handles checkout and credits only.", unavailable: "The article has not been saved.", waiting: "Save a web article first.",
    extractedAt: "Extracted at", originalTitle: "Page title", sourceType: "Web page",
    located: "The article is selected in the file manager.", locateFailed: "Could not show the article in the file manager.",
    dissection: { title: "Article dissection", confirmation: "Confirm article dissection", close: "Close article dissection confirmation", characters: "Article characters", tooLong: "This article exceeds the six-call processing limit.", stale: "The article has changed. Generate a new dissection to locate its source.", locate: "Locate in article" },
    stages: { web_loading: "Load web page", web_extracting: "Extract article", web_saving: "Save note" },
  },
} as const;
