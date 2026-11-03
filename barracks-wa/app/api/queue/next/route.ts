import { visitBranch, visitBranchError } from "@/server/auth/branch-access";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { nextCustomerConfirmSchema } from "@/server/schemas/queue.schema";
import { confirmNextCustomerAssignment, getNextCustomer, QueueServiceError } from "@/server/services/queue.service";

export const runtime = "nodejs";
const noCandidateMessage = "No eligible customer is waiting for this barber.";

export async function GET(request: Request) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  const barberId = Number(new URL(request.url).searchParams.get("barberId"));
  if (!Number.isSafeInteger(barberId) || barberId < 1)
    return Response.json({ success: false, message: "Choose a barber." }, { status: 400 });
  try {
    const branchId = await visitBranch(pool, actor, request);
    const barber = (await pool.query("SELECT branch_id FROM barbers WHERE id=$1", [barberId])).rows[0];
    if (!barber || Number(barber.branch_id) !== branchId) return Response.json({ success: false, message: "Choose a barber in this branch" }, { status: 403 });
    const entry = await getNextCustomer(pool, barberId, branchId);
    return Response.json({ success: true, entry, message: entry ? null : noCandidateMessage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof QueueServiceError)
      return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: error.kind === "not_found" ? 404 : 409 });
    console.error("Unable to find next customer", error);
    return Response.json({ success: false, message: "Unable to find next customer" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: "Choose a barber and suggested customer." }, { status: 400 });
  }
  const parsed = nextCustomerConfirmSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ success: false, message: "Choose a barber and suggested customer." }, { status: 400 });
  try {
    const branchId = await visitBranch(pool, actor, request);
    const pair = (await pool.query("SELECT q.id FROM queue_entries q JOIN barbers b ON b.id=$2 WHERE q.id=$1 AND q.branch_id=$3 AND b.branch_id=$3", [parsed.data.entryId, parsed.data.barberId, branchId])).rows[0];
    if (!pair) return Response.json({ success: false, message: "Choose a customer and barber in this branch" }, { status: 403 });
    return Response.json({ success: true, entry: await confirmNextCustomerAssignment(pool, parsed.data.barberId, parsed.data.entryId, branchId, actor) });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof QueueServiceError)
      return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: error.kind === "not_found" ? 404 : 409 });
    console.error("Unable to confirm next customer", error);
    return Response.json({ success: false, message: "Unable to confirm next customer" }, { status: 500 });
  }
}
