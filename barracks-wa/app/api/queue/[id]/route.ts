import { requireBranchAccess, visitBranchError, type BranchActor } from "@/server/auth/branch-access";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { queueChangeSchema } from "@/server/schemas/queue.schema";
import { BookingServiceError, updateBooking } from "@/server/services/booking.service";
import { QueueLifecycleError, transitionQueue } from "@/server/services/queue-lifecycle";
import { assignQueueBarber, findQueueEntry, QueueServiceError, updateWalkInStatus } from "@/server/services/queue.service";

export const runtime = "nodejs";
async function change(id: number, body: unknown, actor: BranchActor) {
  const parsed = queueChangeSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid queue change" }, { status: 400 });
  try {
    const current = await findQueueEntry(pool, id);
    if (!current) return Response.json({ success: false, message: "Queue entry not found" }, { status: 404 });
    await requireBranchAccess(pool, actor, current.branchId);
    if ("barberId" in parsed.data) return Response.json({ success: true, entry: await assignQueueBarber(pool, id, parsed.data.barberId) });
    transitionQueue({ status: current.status, barberId: current.barberId, startedAt: current.startedAt, completedAt: current.completedAt }, { status: parsed.data.status });
    if (current.bookingId !== null) {
      if (parsed.data.status !== "in_progress" && parsed.data.status !== "completed") throw new QueueServiceError("conflict", "Manage appointment status from Bookings");
      const booking = await updateBooking(pool, current.bookingId, { status: parsed.data.status }, { actor });
      if (!booking) throw new QueueServiceError("not_found", "Booking not found");
      return Response.json({ success: true, entry: await findQueueEntry(pool, id) });
    }
    return Response.json({ success: true, entry: await updateWalkInStatus(pool, id, parsed.data.status, actor) });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof QueueServiceError || error instanceof BookingServiceError || error instanceof QueueLifecycleError) return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: 409 });
    console.error("Unable to change queue entry", error);
    return Response.json({ success: false, message: "Unable to change queue entry" }, { status: 500 });
  }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ success: false, message: "Queue entry not found" }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid queue change" }, { status: 400 }); }
  return change(id, body, actor);
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ success: false, message: "Queue entry not found" }, { status: 404 });
  return change(id, { status: "removed" }, actor);
}
