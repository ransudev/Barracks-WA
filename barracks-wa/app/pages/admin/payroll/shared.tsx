"use client";

import { Badge } from "@/app/components/ui";
import { apiRequest, readApiBody } from "@/app/lib/api";
import type { PayrollRate, PayrollRecord, UnresolvedService } from "@/app/types/payroll";
import { statusLabel } from "@/app/utils/payroll";

export function Status({ record }: { record: PayrollRecord }) {
  return (
    <Badge
      tone={
        record.status === "paid"
          ? "success"
          : record.status === "pending_approval"
            ? "warning"
            : "neutral"
      }
    >
      {statusLabel(record.status)}
    </Badge>
  );
}
export async function payrollRequest<T>(
  query: string,
  command?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiRequest(`/api/payroll${query}`, {
    cache: "no-store",
    signal,
    ...(command ? { method: "POST", body: JSON.stringify(command) } : {}),
  });
  const body = await readApiBody<T & { success: boolean; message?: string }>(response);
  if (!response.ok || !body?.success) throw new Error(body?.message ?? "Unable to load payroll");
  return body;
}
export type Editor =
  | { kind: "configure" }
  | { kind: "generate" }
  | { kind: "rate"; barber: PayrollRate }
  | { kind: "correct_snapshot"; service: UnresolvedService }
  | {
      kind: "supplement" | "adjust" | "submit" | "return" | "approve" | "pay";
      record: PayrollRecord;
    };
export const editorTitles: Record<Editor["kind"], string> = {
  configure: "Configure payroll calendar",
  generate: "Generate payroll draft",
  rate: "Set commission rate",
  correct_snapshot: "Confirm historical rate",
  supplement: "Create correction draft",
  adjust: "Add adjustment",
  submit: "Submit for approval",
  return: "Return to draft",
  approve: "Approve payroll",
  pay: "Record external disbursement",
};
