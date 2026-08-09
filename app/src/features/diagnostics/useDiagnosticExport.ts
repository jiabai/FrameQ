import { useCallback, useRef, useState } from "react";

import { exportDiagnostics as runDiagnosticExport } from "../../diagnosticExportClient";
import { uiMessage, type UiMessage } from "../../i18n/uiMessage";

export function useDiagnosticExport() {
  const inFlightRef = useRef(false);
  const [diagnosticExportBusy, setDiagnosticExportBusy] = useState(false);
  const [diagnosticExportNotice, setDiagnosticExportNotice] =
    useState<UiMessage | null>(null);

  const exportDiagnostics = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setDiagnosticExportBusy(true);
    setDiagnosticExportNotice(null);
    try {
      const result = await runDiagnosticExport();
      if (result.status === "exported") {
        setDiagnosticExportNotice(uiMessage("diagnostics.notice.exported"));
      } else if (result.status === "failed") {
        setDiagnosticExportNotice(uiMessage("diagnostics.notice.exportFailed"));
      }
    } catch {
      setDiagnosticExportNotice(uiMessage("diagnostics.notice.exportFailed"));
    } finally {
      inFlightRef.current = false;
      setDiagnosticExportBusy(false);
    }
  }, []);

  return {
    exportDiagnostics,
    diagnosticExportBusy,
    diagnosticExportNotice,
  };
}

export type DiagnosticExportController = ReturnType<typeof useDiagnosticExport>;
