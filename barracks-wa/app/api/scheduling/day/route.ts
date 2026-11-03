import { z } from "zod";
import { requireStaffUser } from "@/server/auth/require-role";
import { resolveOperationalBranch } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";
import { pool } from "@/server/db/pool";
import { listShopHours, listBranchDaySchedules } from "@/server/services/schedule.service";

export const runtime = "nodejs";

// Read-only context for staff appointment lookup. Mutation routes retain their guards.
export async function GET(request: Request) {
  const actor = await requireStaffUser();
  if (actor instanceof Response) return actor;
  const parsed = z.iso.date().safeParse(new URL(request.url).searchParams.get("date"));
  if (!parsed.success) return Response.json({ success: false, message: "Choose a valid date" }, { status: 400 });
  try {
    const branchId = await resolveOperationalBranch(pool, actor, new URL(request.url).searchParams.get("branchId"));
    const date = parsed.data;
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const from = `${date}T00:00:00+08:00`;
    const to = `${next.toISOString().slice(0, 10)}T00:00:00+08:00`;
    const [barbers, hours] = await Promise.all([
      listBranchDaySchedules(pool, branchId, dayOfWeek, from, to),
      listShopHours(pool, branchId).then((days) => ({ shopHours: days.find((hour) => hour.dayOfWeek === dayOfWeek) ?? null, hoursError: "" }))
        .catch((cause: unknown) => ({ shopHours: null, hoursError: cause instanceof Error ? cause.message : "Shop hours unavailable" })),
    ]);
    const { shopHours, hoursError } = hours;
    return Response.json({ success: true, date, barbers, shopHours, hoursError, timezone: "Asia/Manila" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    console.error("Unable to load day schedule", cause);
    return branchApiError(cause);
  }
}
