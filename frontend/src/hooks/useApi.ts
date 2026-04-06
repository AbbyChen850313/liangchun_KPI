/**
 * Generic data-fetching hook backed by the Flask API.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useApi<DashboardData>(
 *     () => api.get("/api/dashboard").then(r => r.data)
 *   );
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Use a ref to track the current fetcher without causing re-renders
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Serialise deps to a stable primitive so useCallback does not recreate on
  // every render when the caller passes an inline array (e.g. [tab]).
  const depKey = deps.map(String).join("\x00");

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (err: any) {
      setError(err?.message ?? "載入失敗");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, refetch: run };
}
