import { requireRolesUser, requireManagement } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { serviceIdSchema, serviceUpdateSchema } from "@/server/schemas/service.schema";
import { formatValidationErrors } from "@/server/schemas/user.schema";
import { deleteService, findServiceById, updateService } from "@/server/services/service.service";
import { RecordLockedError } from "@/server/services/record-locks";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function DELETE(_request: Request, { params }: Context) {
  const denied = await requireManagement(); if (denied) return denied;
  const id = serviceIdSchema.safeParse((await params).id);
  if (!id.success) return Response.json({ success: false, message: "Service not found" }, { status: 404 });
  try {
    const result = await deleteService(pool, id.data);
    if (result === "not_found") return Response.json({ success: false, message: "Service not found" }, { status: 404 });
    if (result === "has_history") return Response.json({ success: false, code: "SERVICE_HAS_HISTORY", message: "This service has bookings, queue visits, or transactions. Archive it to preserve its history." }, { status: 409 });
    return Response.json({ success: true, message: "Service deleted" });
  } catch (error) {
    console.error("Unable to delete service", error);
    return Response.json({ success: false, message: "Unable to delete service" }, { status: 500 });
  }
}
export async function GET(_request: Request, { params }: Context) {
  const actor = await requireRolesUser(["customer", "front_desk", "manager", "administrator"]);
  if (actor instanceof Response) return actor;
  const parsed = serviceIdSchema.safeParse((await params).id);
  if (!parsed.success) return Response.json({ success: false, message: "Service not found" }, { status: 404 });
  try {
    const service = await findServiceById(pool, parsed.data);
    if (!service || (actor.role === "customer" && !service.active)) return Response.json({ success: false, message: "Service not found" }, { status: 404 });
    return Response.json({ success: true, service });
  } catch (error) { console.error("Unable to load service", error); return Response.json({ success: false, message: "Unable to load service" }, { status: 500 }); }
}
export async function PATCH(request: Request, { params }: Context) {
  const denied = await requireManagement(); if (denied) return denied;
  const id = serviceIdSchema.safeParse((await params).id);
  if (!id.success) return Response.json({ success: false, message: "Service not found" }, { status: 404 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid service information" }, { status: 400 }); }
  const parsed = serviceUpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, errors: formatValidationErrors(parsed.error) }, { status: 400 });
  try {
    const service = await updateService(pool, id.data, parsed.data);
    return service ? Response.json({ success: true, service }) : Response.json({ success: false, message: "Service not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof RecordLockedError) return Response.json({ success: false, code: error.code, message: error.message }, { status: 409 });
    if (error instanceof Error && error.message === "Set a positive duration before enabling this service") return Response.json({ success: false, message: error.message }, { status: 400 });
    console.error("Unable to update service", error); return Response.json({ success: false, message: "Unable to update service" }, { status: 500 });
  }
}
