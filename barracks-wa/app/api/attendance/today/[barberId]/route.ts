import { resolveOperationalBranch } from "@/server/auth/branch-access";
import { BranchError } from "@/server/services/branch.service";
import { branchApiError } from "@/server/services/branch-api";
import { requireStaffUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { attendanceActionSchema } from "@/server/schemas/attendance.schema";
import { actOnTodayAttendance, AttendanceConflict } from "@/server/services/attendance.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ barberId: string }> }) {
  const user = await requireStaffUser();
  if (user instanceof Response) return user;
  const barberId = parseRouteId((await params).barberId);
  if (barberId === null)
    return Response.json({ success: false, message: "Invalid barber id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: "Invalid attendance action" }, { status: 400 }); }
  const parsed = attendanceActionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid attendance action" }, { status: 400 });
  try {
    const rawBranch = new URL(request.url).searchParams.get("branchId");
    const branchId = rawBranch === null ? undefined : await resolveOperationalBranch(pool, user, rawBranch);
    const attendance = await actOnTodayAttendance(pool, barberId, user.id, parsed.data, branchId);
    return attendance ? Response.json({ success: true, attendance })
      : Response.json({ success: false, message: "Barber not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof BranchError) return branchApiError(error);
    if (error instanceof AttendanceConflict) return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("Unable to update attendance", error);
    return Response.json({ success: false, message: "Unable to update attendance" }, { status: 500 });
  }
}
