import { withAuthorizedBarber, requireBranchAccess } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";
import { requireAdministrator, requireManagementUser, requireStaffUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { barberSchema, barberStaffSchema, formatValidationErrors } from "@/server/schemas/sprint.schema";
import { BarberMoveConflict, deleteBarber, findBarberById, updateBarber } from "@/server/services/barber.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffUser();
  if (actor instanceof Response) return actor;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid barber id" }, { status: 400 });
  try {
    const barber = await withAuthorizedBarber(pool, actor, id, (client) => findBarberById(client, id));
    if (!barber) return Response.json({ success: false, message: "Barber not found" }, { status: 404 });
    return Response.json({ success: true, barber: actor.role === "front_desk"
      ? { id: barber.id, firstName: barber.firstName, lastName: barber.lastName, status: barber.status }
      : barber });
  } catch (error) {
    return branchApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireManagementUser();
  if (actor instanceof Response) return actor;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid barber id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, message: "Invalid barber information" }, { status: 400 });
  }
  const parsed = (actor.role === "administrator" ? barberSchema : barberStaffSchema).safeParse(body);
  if (!parsed.success) {
    return Response.json({ success: false, message: "Invalid barber information", errors: formatValidationErrors(parsed.error) }, { status: 400 });
  }
  try {
    await requireBranchAccess(pool, actor, parsed.data.branchId);
    const barber = await withAuthorizedBarber(pool, actor, id, (client) => updateBarber(client, id, parsed.data));
    if (!barber) return Response.json({ success: false, message: "Barber not found" }, { status: 404 });
    return Response.json({ success: true, barber });
  } catch (error) {
    if (error instanceof BarberMoveConflict) return Response.json({ success: false, message: error.message }, { status: 409 });
    return branchApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorizationResponse = await requireAdministrator();
  if (authorizationResponse) return authorizationResponse;
  const id = parseRouteId((await params).id);
  if (!id) return Response.json({ success: false, message: "Invalid barber id" }, { status: 400 });
  try {
    const result = await deleteBarber(pool, id);
    if (result === "not_found") return Response.json({ success: false, message: "Barber not found" }, { status: 404 });
    if (result === "referenced") {
      return Response.json(
        {
          success: false,
          message: "This barber cannot be deleted while linked records, including bookings or attendance history, reference the profile.",
        },
        { status: 409 },
      );
    }
    return Response.json({ success: true, message: "Barber deleted" });
  } catch (error) {
    console.error("Unable to delete barber", error);
    return Response.json({ success: false, message: "Unable to delete barber" }, { status: 500 });
  }
}
