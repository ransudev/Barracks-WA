import { visitBranch, requireBranchAccess, listAccessibleBranches, resolveOperationalBranch } from "@/server/auth/branch-access";
import { branchApiError } from "@/server/services/branch-api";
import { requireAdministrator, requireManagementUser, requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { barberSchema, barberStaffSchema, formatValidationErrors } from "@/server/schemas/sprint.schema";
import { createBarber, listBarberAvailability, listBarbers } from "@/server/services/barber.service";
import { listBarberOperationalAvailability } from "@/server/services/barber-operational-availability.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorizationResult = await requireRolesUser(["administrator", "manager", "front_desk", "customer"]);
  if (authorizationResult instanceof Response) return authorizationResult;
  try {
    const actor = authorizationResult;
    const params = new URL(request.url).searchParams;
    const rawBranch = params.get("branchId");
    const optionsOnly = params.get("view") === "options";
    const branchIds = actor.role === "customer" ? [await visitBranch(pool, actor, request)]
      : rawBranch !== null || actor.role === "front_desk" ? [await resolveOperationalBranch(pool, actor, rawBranch)]
      : actor.role === "administrator" ? undefined : (await listAccessibleBranches(pool, actor)).map((branch) => branch.id);
    const barbers = optionsOnly || authorizationResult.role === "customer" || authorizationResult.role === "front_desk"
      ? await listBarberAvailability(pool, branchIds)
      : await listBarbers(pool, branchIds);
    const availability = optionsOnly || actor.role === "customer" ? null
      : await listBarberOperationalAvailability(pool, barbers.map((barber) => barber.id));
    const operationalBarbers = availability ? barbers.map((barber) => ({
      ...barber, operationalAvailability: availability.get(barber.id) ?? { available: false, reason: "barber_not_found", activeQueueEntryId: null },
    })) : barbers;
    return Response.json({ success: true, barbers: operationalBarbers });
  } catch (error) {
    return branchApiError(error);
  }
}

export async function POST(request: Request) {
  const actor = await requireManagementUser();
  if (actor instanceof Response) return actor;
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
    return Response.json({ success: true, barber: await createBarber(pool, parsed.data, actor.id) }, { status: 201 });
  } catch (error) {
    return branchApiError(error);
  }
}

export async function PATCH() {
  const authorizationResponse = await requireAdministrator();
  if (authorizationResponse) return authorizationResponse;

  return Response.json({ success: false, message: "Set individual rates in Payroll settings with an effective time and audit reason" }, { status: 409 });
}
