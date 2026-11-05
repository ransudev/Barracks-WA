"use client";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BranchContext } from "@/app/types/branch";
import { resolveBranchSelection } from "@/app/utils/branch-context";
import { apiRequest, readApiBody } from "@/app/lib/api";

type BranchContextValue = BranchContext & {
  branchId: number;
  setBranchId: (id: number) => void;
  branchError: string;
  branchLoading: boolean;
};

const BranchSelectionContext = createContext<BranchContextValue | null>(null);

function useLocalBranchContext(enabled: boolean): BranchContextValue {
  const [context, setContext] = useState<BranchContext>({ branches: [], primaryBranch: null });
  const [branchId, setBranchId] = useState(0);
  const [branchLoading, setBranchLoading] = useState(true);
  const [branchError, setBranchError] = useState("");
  const selectBranch = useCallback((id: number) => setBranchId(id), []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      try {
        const response = await apiRequest("/api/branch-context", { cache: "no-store" });
        const body = await readApiBody<BranchContext & { message?: string }>(response);
        if (!response.ok || !body?.branches)
          throw new Error(body?.message ?? "Unable to load branches");
        if (active) {
          const linkedId = Number(new URLSearchParams(window.location.search).get("branchId"));
          const linkedBranch = body.branches.find((branch) => branch.id === linkedId);
          setContext(body);
          setBranchId(linkedBranch?.id ?? resolveBranchSelection(body)?.id ?? 0);
        }
      } catch (error) {
        if (active)
          setBranchError(error instanceof Error ? error.message : "Unable to load branches");
      } finally {
        if (active) setBranchLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);
  return useMemo(
    () => ({ ...context, branchId, setBranchId: selectBranch, branchError, branchLoading }),
    [context, branchId, selectBranch, branchError, branchLoading],
  );
}

export function BranchContextProvider({ children }: { children: ReactNode }) {
  const value = useLocalBranchContext(true);
  return createElement(BranchSelectionContext.Provider, { value }, children);
}

export function useBranchContext() {
  const shared = useContext(BranchSelectionContext);
  const local = useLocalBranchContext(shared === null);
  return shared ?? local;
}
