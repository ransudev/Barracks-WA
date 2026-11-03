import { visitBranch, visitBranchError } from "@/server/auth/branch-access";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { walkInSchema } from "@/server/schemas/queue.schema";
import { addWalkIn, listQueue, QueueServiceError } from "@/server/services/queue.service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  const view = new URL(request.url).searchParams.get("view") ?? "active";
  if (view !== "active" && view !== "completed-today") return Response.json({ success: false, message: "Invalid queue view" }, { status: 400 });
  try { return Response.json({ success: true, queue: await listQueue(pool, view, await visitBranch(pool, actor, request)) }); }
  catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse; console.error("Unable to load queue", error); return Response.json({ success: false, message: "Unable to load queue" }, { status: 500 }); }
}
export async function POST(request: Request) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid walk-in" }, { status: 400 }); }
  const parsed = walkInSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Choose an existing customer or enter a walk-in name, then choose a service and optional barber" }, { status: 400 });
  try { return Response.json({ success: true, entry: await addWalkIn(pool, { ...parsed.data, branchId: await visitBranch(pool, actor, request) }) }, { status: 201 }); }
  catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof QueueServiceError) return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: error.kind === "conflict" ? 409 : error.kind === "not_found" ? 404 : 400 });
    console.error("Unable to add walk-in", error);
    return Response.json({ success: false, message: "Unable to add walk-in" }, { status: 500 });
  }
}
