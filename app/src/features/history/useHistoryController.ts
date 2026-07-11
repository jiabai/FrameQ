import { useCallback, useRef, useState } from "react";

import {
  getHistory,
  getHistoryDetail,
  type HistoryItem,
  type HistoryListItem,
} from "../../historyClient";

type UseHistoryControllerOptions = {
  onHistoryItemSelected: (item: HistoryItem) => void;
};

export function useHistoryController({
  onHistoryItemSelected,
}: UseHistoryControllerOptions) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryListItem[]>([]);
  const [historyNotice, setHistoryNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const detailRequestIdRef = useRef(0);

  const closeHistory = useCallback(() => {
    detailRequestIdRef.current += 1;
    setHistoryOpen(false);
  }, []);

  const openHistory = useCallback(async () => {
    detailRequestIdRef.current += 1;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryItems([]);
    setHistoryNotice("正在读取历史记录。");
    try {
      const items = await getHistory();
      setHistoryItems(items);
      setHistoryNotice(items.length > 0 ? "" : "暂无历史任务。");
    } catch (error) {
      setHistoryNotice(`读取历史失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistoryItem = useCallback(
    async (item: HistoryListItem) => {
      const requestId = detailRequestIdRef.current + 1;
      detailRequestIdRef.current = requestId;
      setHistoryLoading(true);
      setHistoryNotice("正在读取历史任务详情。");
      try {
        const detail = await getHistoryDetail(item.taskId);
        if (detailRequestIdRef.current !== requestId) {
          return;
        }
        onHistoryItemSelected(detail);
        setHistoryOpen(false);
        setHistoryNotice("");
      } catch (error) {
        if (detailRequestIdRef.current === requestId) {
          setHistoryNotice(
            `读取历史任务详情失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        if (detailRequestIdRef.current === requestId) {
          setHistoryLoading(false);
        }
      }
    },
    [onHistoryItemSelected],
  );

  return {
    historyOpen,
    historyItems,
    historyNotice,
    historyLoading,
    closeHistory,
    openHistory,
    openHistoryItem,
  };
}

export type HistoryController = ReturnType<typeof useHistoryController>;
