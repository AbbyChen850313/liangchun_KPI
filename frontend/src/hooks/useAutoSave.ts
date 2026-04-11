/**
 * useAutoSave — debounce auto-save hook.
 * Calls saveFn after delayMs of inactivity. Skips when disabled.
 * Registers a beforeunload handler that fires saveFn immediately on page exit.
 */

import { useEffect, useRef, useState } from "react";

export function useAutoSave(
  saveFn: () => Promise<void>,
  deps: unknown[],
  disabled: boolean,
  delayMs = 2000
): { lastSavedAt: Date | null } {
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest saveFn in a ref so the timer always calls the up-to-date closure.
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  // Debounced save — resets whenever deps or disabled change.
  useEffect(() => {
    if (disabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await saveFnRef.current();
        setLastSavedAt(new Date());
      } catch {
        // Silent fail — user can still save manually.
      }
    }, delayMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  // deps spread is intentional; disabled and delayMs are stable scalars.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, delayMs, ...deps]);

  // Immediate save on page exit (best-effort, no await).
  useEffect(() => {
    if (disabled) return;
    const handleBeforeUnload = () => {
      saveFnRef.current().catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [disabled]);

  return { lastSavedAt };
}
