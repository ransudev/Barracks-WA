import type { Branch, BranchContext } from "@/app/types/branch";

// Selectors reconcile a preferred ID with fresh server context. Phase 2 mounts
// this foundation on barber management and Barber Floor.
export function resolveBranchSelection(
  context: BranchContext,
  preferredId: number | null = null,
): Branch | null {
  return (
    context.branches.find((branch) => branch.id === preferredId) ??
    context.branches.find((branch) => branch.id === context.primaryBranch?.id) ??
    context.branches.find((branch) => branch.status === "active") ??
    context.branches[0] ??
    null
  );
}
