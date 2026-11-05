"use client";

import { useEffect, useState } from "react";
import { apiRequest, readApiBody, errorMessage } from "@/app/lib/api";
import type { ReportRange } from "./report-utils";

export function useReport<T extends { success: boolean; message?: string }>(
  endpoint: string,
  range: ReportRange,
  onToast: (message: string) => void,
  branch: string,
) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const key = `${endpoint}:${branch}:${range.from}:${range.to}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await apiRequest(
          `${endpoint}?${new URLSearchParams({ ...range, branchId: branch })}`,
          { cache: "no-store" },
        );
        const data = await readApiBody<T>(response);
        if (!response.ok || !data?.success)
          throw new Error(data?.message ?? "Unable to load report");
        if (!cancelled) setResult({ key, data, error: null });
      } catch (error) {
        if (cancelled) return;
        const message = errorMessage(error, "Unable to load report");
        setResult({ key, data: null, error: message });
        onToast(message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [endpoint, range, key, onToast, branch]);

  const current = result.key === key;
  return {
    data: current ? result.data : null,
    error: current ? result.error : null,
    loading: !current,
    retry: () => setAttempt((value) => value + 1),
  };
}
