import { withAuthorizedBarber } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";
import { z } from "zod";
import { requireStaffUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { barberStatusSchema } from "@/server/schemas/sprint.schema";
import { updateBarberStatus } from "@/server/services/barber.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

const statusUpdateSchema = z.object({ status: barberStatusSchema }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffUser();
  if (actor instanceof Response) return actor;
  const id = parseRouteId((await params).id);
  if (id === null)
    return Response.json({ success: false, message: "Invalid barber id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: "Invalid barber status" }, { status: 400 }); }
  const parsed = statusUpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid barber status" }, { status: 400 });
  try {
    const barber = await withAuthorizedBarber(pool, actor, id, (client) => updateBarberStatus(client, id, parsed.data.status));
    return barber
      ? Response.json({ success: true, barber })
      : Response.json({ success: false, message: "Barber not found" }, { status: 404 });
  } catch (error) {
    return branchApiError(error);
  }
}
