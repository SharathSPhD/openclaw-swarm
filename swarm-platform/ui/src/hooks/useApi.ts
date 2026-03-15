import { useState, useEffect, useCallback } from "react";

export function useApi<T>(url: string, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    if (intervalMs > 0) {
      const timer = setInterval(fetchData, intervalMs);
      return () => clearInterval(timer);
    }
  }, [fetchData, intervalMs]);

  return { data, error, loading, refetch: fetchData };
}

export async function postApi<T>(url: string, body: unknown, apiKey?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return res.json();
}
