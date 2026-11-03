import { visitBranch, visitBranchError } from "@/server/auth/branch-access";
import { requireRolesUser, requireManagement } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { serviceSchema } from "@/server/schemas/service.schema";
import { formatValidationErrors } from "@/server/schemas/user.schema";
import { createService, listServices } from "@/server/services/service.service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireRolesUser(["customer", "front_desk", "manager", "administrator"]);
  if (actor instanceof Response) return actor;
  try {
    if (actor.role === "customer") await visitBranch(pool, actor, request);
    return Response.json({ success: true, services: await listServices(pool, actor.role === "customer") });
  } catch (error) {
    const response = visitBranchError(error);
    if (response) return response;
    console.error("Unable to list services", error);
    return Response.json({ success: false, message: "Unable to load services" }, { status: 500 });
  }
}
export async function POST(request: Request) {
  const denied = await requireManagement(); if (denied) return denied;
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ success: false, message: "Invalid service information" }, { status: 400 }); }
  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, errors: formatValidationErrors(parsed.error) }, { status: 400 });
  try { return Response.json({ success: true, service: await createService(pool, parsed.data) }, { status: 201 }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return Response.json({ success: false, message: "Service ID already exists" }, { status: 409 });
    console.error("Unable to create service", error); return Response.json({ success: false, message: "Unable to create service" }, { status: 500 });
  }
}
