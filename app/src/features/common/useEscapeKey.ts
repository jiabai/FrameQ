import { useEffect, useRef } from "react";

/** Runs the first handler whose sheet is open. Handlers are ordered by priority. */
export function useEscapeKey(handlers: Array<[open: boolean, close: () => void]>): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      handlersRef.current.find(([open]) => open)?.[1]();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);
}
