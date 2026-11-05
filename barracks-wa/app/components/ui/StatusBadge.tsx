import type { ReactNode } from "react";
import { Badge } from "./index";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "purple";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return <Badge tone={tone}>{children}</Badge>;
}
