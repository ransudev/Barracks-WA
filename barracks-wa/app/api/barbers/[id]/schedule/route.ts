import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { weeklyScheduleSchema, unavailabilitySchema } from "@/server/schemas/schedule.schema";
import { addBarberUnavailability, listBarberSchedules, listBarberUnavailability, removeBarberUnavailability, saveBarberSchedule } from "@/server/services/schedule.service";
import { withAuthorizedBarber } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function barberId(context: Context): Promise<number | null> { const id = Number((await context.params).id); return Number.isSafeInteger(id) && id > 0 ? id : null; }
export async function GET(_request: Request, context: Context) {
  const actor = await requireManagementUser(); if (actor instanceof Response) return actor;
  const id = await barberId(context); if (!id) return Response.json({ success: false, message: "Invalid barber" }, { status: 400 });
  try {
    return await withAuthorizedBarber(pool, actor, id, async (client) => Response.json({ success: true, schedules: await listBarberSchedules(client, id), unavailability: await listBarberUnavailability(client, id) }));
  } catch (error) { return branchApiError(error); }
}
export async function PUT(request: Request, context: Context) {
  const actor = await requireManagementUser(); if (actor instanceof Response) return actor;
  const id = await barberId(context); if (!id) return Response.json({ success: false, message: "Invalid barber" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid schedule" }, { status: 400 }); }
  const parsed = weeklyScheduleSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid schedule", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
  try { return await withAuthorizedBarber(pool, actor, id, async (client) => Response.json({ success: true, schedules: await saveBarberSchedule(client, id, parsed.data) })); }
  catch (error) { return branchApiError(error); }
}
export async function POST(request: Request, context: Context) {
  const actor = await requireManagementUser(); if (actor instanceof Response) return actor;
  const id = await barberId(context); if (!id) return Response.json({ success: false, message: "Invalid barber" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid unavailability" }, { status: 400 }); }
  const parsed = unavailabilitySchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "Invalid unavailability", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
  try { return await withAuthorizedBarber(pool, actor, id, async (client) => Response.json({ success: true, unavailability: await addBarberUnavailability(client, id, parsed.data) }, { status: 201 })); }
  catch (error) { return branchApiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  const actor = await requireManagementUser(); if (actor instanceof Response) return actor;
  const id = await barberId(context); const periodId = Number(new URL(request.url).searchParams.get("periodId"));
  if (!id || !Number.isSafeInteger(periodId) || periodId <= 0) return Response.json({ success: false, message: "Invalid period" }, { status: 400 });
  try { const removed = await withAuthorizedBarber(pool, actor, id, (client) => removeBarberUnavailability(client, id, periodId)); return Response.json({ success: removed, message: removed ? undefined : "Period not found" }, { status: removed ? 200 : 404 }); }
  catch (error) { return branchApiError(error); }
}
