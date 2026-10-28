import { useEffect, useState } from "react";

/**
 * Keeps the last non-null value so a sheet can keep rendering its content
 * through the closing animation after the prop becomes null.
 */
export function useLastDefined<T>(value: T | null, fallback: T): T;
export function useLastDefined<T>(value: T | null, fallback: null): T | null;
export function useLastDefined<T>(value: T | null, fallback: T | null): T | null {
  const [last, setLast] = useState<T | null>(value ?? fallback);

  useEffect(() => {
    if (value !== null) {
      setLast(value);
    }
  }, [value]);

  return value ?? last;
}
