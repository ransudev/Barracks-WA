import { requireBranchAccess, visitBranchError } from "@/server/auth/branch-access";
import { canManageBooking, type BookingAction } from "@/app/constants/roles";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { bookingEditSchema, bookingUpdateSchema, customerBookingEditSchema, formatValidationErrors } from "@/server/schemas/sprint.schema";
import { BookingServiceError, deleteBooking, findBookingById, updateBooking, updateBookingDetails, type BookingRecord } from "@/server/services/booking.service";
import { findCustomerByUserId } from "@/server/services/customer.service";
import type { PublicUser } from "@/server/services/user.service";

export const runtime = "nodejs";

type AuthorizedBooking = {
  booking: BookingRecord;
  customerId?: number;
};

async function authorizeBookingAction(
  id: number,
  actor: PublicUser,
  action: BookingAction,
): Promise<AuthorizedBooking | Response> {
  const booking = await findBookingById(pool, id);
  if (!booking) return Response.json({ success: false, message: "Booking not found" }, { status: 404 });

  let customerId: number | undefined;
  if (actor.role === "customer") {
    const customer = await findCustomerByUserId(pool, actor.id);
    if (!customer) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
    customerId = customer.id;
  }

  if (!canManageBooking(actor.role, action, customerId === booking.customerId)) {
    return Response.json({ success: false, message: "You do not have permission to manage this booking" }, { status: 403 });
  }

  if (actor.role !== "customer") {
    try { await requireBranchAccess(pool, actor, booking.branchId); }
    catch (error) { const response = visitBranchError(error); if (response) return response; throw error; }
  }
  return { booking, customerId };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk", "customer"]);
  if (actor instanceof Response) return actor;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) {
    return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: "Invalid booking update" }, { status: 400 });
  }
  const parsed = bookingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, message: "Invalid booking update", errors: formatValidationErrors(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const authorization = await authorizeBookingAction(
      id,
      actor,
      ({ confirmed: "confirm", rejected: "reject", cancelled: "cancel", checked_in: "check_in", in_progress: "start", completed: "complete", no_show: "no_show" } as const)[parsed.data.status],
    );
    if (authorization instanceof Response) return authorization;
    if (actor.role === "customer" && parsed.data.status === "cancelled" && !["pending", "confirmed"].includes(authorization.booking.status)) {
      return Response.json({ success: false, message: "Only pending or confirmed bookings can be cancelled" }, { status: 409 });
    }

    const booking = await updateBooking(
      pool,
      id,
      parsed.data,
      authorization.customerId ? { customerId: authorization.customerId } : { actor },
    );
    if (!booking) return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
    return Response.json({ success: true, booking });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof BookingServiceError) {
      if (error.kind === "forbidden") return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: 403 });
      if (error.kind === "not_updatable" || error.kind === "conflict") return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: 409 });
    }
    console.error("Unable to update booking", error);
    return Response.json({ success: false, message: "Unable to update booking" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk", "customer"]);
  if (actor instanceof Response) return actor;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) {
    return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: "Invalid booking information" }, { status: 400 });
  }
  const authorization = await authorizeBookingAction(id, actor, "edit");
  if (authorization instanceof Response) return authorization;

  const parsed = actor.role === "customer"
    ? customerBookingEditSchema.safeParse(body)
    : bookingEditSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, message: "Invalid booking information", errors: formatValidationErrors(parsed.error) },
      { status: 400 },
    );
  }

  if (actor.role === "customer" && !parsed.data.barberId) {
    return Response.json({ success: false, message: "Choose a barber" }, { status: 400 });
  }

  try {
    const input = {
      branchId: authorization.booking.branchId,
      customerId: actor.role === "customer"
        ? authorization.customerId as number
        : Number("customerId" in parsed.data ? parsed.data.customerId : authorization.customerId),
      barberId: parsed.data.barberId,
      serviceId: parsed.data.serviceId,
      date: parsed.data.date,
      time: parsed.data.time,
      notes: parsed.data.notes,
    };
    const booking = await updateBookingDetails(
      pool,
      id,
      input,
      authorization.customerId ? { customerId: authorization.customerId } : undefined,
    );
    if (!booking) return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
    return Response.json({ success: true, booking });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof BookingServiceError) {
      if (error.kind === "forbidden") return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: 403 });
      const status = error.kind === "conflict" || error.kind === "unavailable" || error.kind === "not_updatable" ? 409 : 400;
      return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status });
    }
    console.error("Unable to edit booking", error);
    return Response.json({ success: false, message: "Unable to update booking" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireRolesUser(["administrator", "manager", "front_desk"]);
  if (actor instanceof Response) return actor;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) {
    return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
  }

  try {
    const authorization = await authorizeBookingAction(id, actor, "delete");
    if (authorization instanceof Response) return authorization;

    const deleted = await deleteBooking(pool, id);
    if (!deleted) return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
    return Response.json({ success: true, message: "Booking deleted" });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof BookingServiceError && error.kind === "not_deletable") {
      return Response.json({ success: false, message: error.message, reason: "reason" in error ? error.reason : undefined, interval: "interval" in error ? error.interval : undefined }, { status: 409 });
    }
    console.error("Unable to delete booking", error);
    return Response.json({ success: false, message: "Unable to delete booking" }, { status: 500 });
  }
}
