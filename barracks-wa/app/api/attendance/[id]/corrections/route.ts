import { BranchError } from "@/server/services/branch.service";
import { branchApiError } from "@/server/services/branch-api";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { attendanceCorrectionSchema } from "@/server/schemas/attendance.schema";
import { attendanceBranches, AttendanceConflict, correctAttendance, listAttendanceCorrections } from "@/server/services/attendance.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  const id = parseRouteId((await params).id);
  if (id === null) return Response.json({ success: false, message: "Invalid attendance id" }, { status: 400 });
  try { return Response.json({ success: true, corrections: await listAttendanceCorrections(pool, id, await attendanceBranches(pool, user, request)) }); }
  catch (error) {
    if (error instanceof BranchError) return branchApiError(error);
    console.error("Unable to load attendance corrections", error);
    return Response.json({ success: false, message: "Unable to load corrections" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  const id = parseRouteId((await params).id);
  if (id === null) return Response.json({ success: false, message: "Invalid attendance id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: "Invalid correction" }, { status: 400 }); }
  const parsed = attendanceCorrectionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid correction" }, { status: 400 });
  try {
    const attendance = await correctAttendance(pool, id, user.id, parsed.data);
    return attendance ? Response.json({ success: true, attendance })
      : Response.json({ success: false, message: "Attendance not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof BranchError) return branchApiError(error);
    if (error instanceof AttendanceConflict) return Response.json({ success: false, message: error.message }, { status: 409 });
    console.error("Unable to correct attendance", error);
    return Response.json({ success: false, message: "Unable to correct attendance" }, { status: 500 });
  }
}
