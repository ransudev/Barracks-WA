import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import {
  canChangeStaffLifecycle,
  canDeactivateStaffUser,
  canUpdateStaffUser,
  canViewStaffUser,
} from "@/app/constants/roles";
import type { PublicUser } from "@/server/services/user.service";
import {
  findStaffUserById,
  softDeleteUser,
  updateStaffUser,
  updateUserLifecycle,
} from "@/server/services/user.service";
import {
  formatValidationErrors,
  updateStaffUserSchema,
  userLifecycleSchema,
} from "@/server/schemas/user.schema";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";

function parseUserId(rawId: string): number | Response {
  const id = parseRouteId(rawId);
  if (id === null) {
    return Response.json(
      { success: false, message: "Invalid user id" },
      { status: 400 },
    );
  }
  return id;
}

async function findTarget(id: number, actorId: number): Promise<PublicUser | Response> {
  const target = await findStaffUserById(pool, actorId, id);
  if (!target) {
    return Response.json({ success: false, message: "User not found" }, { status: 404 });
  }
  return target;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const manager = await requireManagementUser();
  if (manager instanceof Response) return manager;

  const id = parseUserId((await params).id);
  if (id instanceof Response) return id;

  try {
    const target = await findTarget(id, manager.id);
    if (target instanceof Response) return target;
    if (!canViewStaffUser(manager.role, target.role)) {
      return Response.json(
        { success: false, message: "You do not have permission to view this staff account" },
        { status: 403 },
      );
    }
    return Response.json({ success: true, user: target });
  } catch (error) {
    console.error("Unable to load user", error);
    return Response.json({ success: false, message: "Unable to load user" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const manager = await requireManagementUser();
  if (manager instanceof Response) return manager;

  const id = parseUserId((await params).id);
  if (id instanceof Response) return id;

  try {
    const target = await findTarget(id, manager.id);
    if (target instanceof Response) return target;
    if (!canDeactivateStaffUser(manager.role, target.role, manager.id, target.id)) {
      return Response.json(
        { success: false, message: "You do not have permission to deactivate this staff account" },
        { status: 403 },
      );
    }

    const result = await softDeleteUser(pool, id, manager.id);
    if (result.kind === "forbidden") return Response.json({success:false,message:"You do not have authority to change this staff account"},{status:403});
    if (result.kind === "not_found") {
      return Response.json({ success: false, message: "User not found" }, { status: 404 });
    }
    if (result.kind === "last_admin") {
      return Response.json(
        { success: false, message: "You cannot deactivate the last administrator account" },
        { status: 409 },
      );
    }
    if (result.kind !== "deleted") {
      return Response.json({ success: false, message: "Unable to deactivate user" }, { status: 500 });
    }
    return Response.json({ success: true, message: "User deactivated" });
  } catch (error) {
    console.error("Unable to delete user", error);
    return Response.json({ success: false, message: "Unable to delete user" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const manager = await requireManagementUser();
  if (manager instanceof Response) return manager;

  const id = parseUserId((await params).id);
  if (id instanceof Response) return id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        success: false,
        message: "Invalid user information",
        errors: { body: ["Request body must be valid JSON"] },
      },
      { status: 400 },
    );
  }

  const parsed = updateStaffUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        message: "Invalid user information",
        errors: formatValidationErrors(parsed.error),
      },
      { status: 400 },
    );
  }

  try {
    const target = await findTarget(id, manager.id);
    if (target instanceof Response) return target;
    if (!canUpdateStaffUser(manager.role, target.role, manager.id, target.id, parsed.data.role)) {
      return Response.json(
        { success: false, message: "You do not have permission to update this staff account" },
        { status: 403 },
      );
    }

    const result = await updateStaffUser(pool, id, parsed.data, manager.id);
    if (result.kind === "forbidden") return Response.json({success:false,message:"You do not have authority to change this staff account"},{status:403});
    if (result.kind === "not_found") {
      return Response.json({ success: false, message: "User not found" }, { status: 404 });
    }
    if (result.kind === "duplicate") {
      return Response.json({ success: false, message: "A user with this email already exists" }, { status: 409 });
    }
    if (result.kind === "invalid_role") {
      return Response.json({ success: false, message: "The selected user role is not available" }, { status: 400 });
    }
    if (result.kind === "last_admin") {
      return Response.json({ success: false, message: "You must keep at least one administrator account" }, { status: 409 });
    }
    if (result.kind !== "updated") {
      return Response.json({ success: false, message: "Unable to update user" }, { status: 500 });
    }
    return Response.json({ success: true, message: "User account updated", user: result.user });
  } catch (error) {
    console.error("Unable to update user", error);
    return Response.json({ success: false, message: "Unable to update user" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const manager = await requireManagementUser();
  if (manager instanceof Response) return manager;

  const id = parseUserId((await params).id);
  if (id instanceof Response) return id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        success: false,
        message: "Invalid account status update",
        errors: { body: ["Request body must be valid JSON"] },
      },
      { status: 400 },
    );
  }

  const parsed = userLifecycleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        message: "Invalid account status update",
        errors: formatValidationErrors(parsed.error),
      },
      { status: 400 },
    );
  }

  try {
    const target = await findTarget(id, manager.id);
    if (target instanceof Response) return target;
    if (!canChangeStaffLifecycle(manager.role, target.role, manager.id, target.id)) {
      return Response.json(
        { success: false, message: "You do not have permission to change this account status" },
        { status: 403 },
      );
    }

    const result = await updateUserLifecycle(pool, id, parsed.data, manager.id);
    if (result.kind === "forbidden") return Response.json({success:false,message:"You do not have authority to change this staff account"},{status:403});
    if (result.kind === "not_found") {
      return Response.json({ success: false, message: "User not found" }, { status: 404 });
    }
    if (result.kind === "last_admin") {
      return Response.json({ success: false, message: "You cannot disable the last administrator account" }, { status: 409 });
    }
    if (result.kind !== "updated") {
      return Response.json({ success: false, message: "Unable to update account status" }, { status: 500 });
    }
    return Response.json({ success: true, message: "Account status updated", user: result.user });
  } catch (error) {
    console.error("Unable to update user status", error);
    return Response.json({ success: false, message: "Unable to update account status" }, { status: 500 });
  }
}
