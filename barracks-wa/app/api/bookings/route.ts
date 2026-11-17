import { visitBranch, visitBranchError } from "@/server/auth/branch-access";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import {
  bookingCreateSchema,
  formatValidationErrors,
} from "@/server/schemas/sprint.schema";
import {
  BookingServiceError,
  createBooking,
  listBookings,
} from "@/server/services/booking.service";
import { findCustomerByUserId } from "@/server/services/customer.service";
import { findServiceById } from "@/server/services/service.service";
import { bookingDeposit } from "@/app/constants/booking";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireRolesUser(["administrator", "manager", "front_desk", "customer"]);
  if (user instanceof Response) return user;

  try {
    if (user.role === "customer") {
      const customer = await findCustomerByUserId(pool, user.id);
      if (!customer) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
      return Response.json({ success: true, bookings: await listBookings(pool, customer.id) });
    }
    return Response.json({ success: true, bookings: await listBookings(pool, undefined, await visitBranch(pool, user, request)) });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    console.error("Unable to list bookings", error);
    return Response.json({ success: false, message: "Unable to load bookings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireRolesUser(["administrator", "manager", "front_desk", "customer"]);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: "Invalid booking information" }, { status: 400 });
  }

  const parsed = bookingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, message: "Invalid booking information", errors: formatValidationErrors(parsed.error) },
      { status: 400 },
    );
  }

  try {
    let customerId = parsed.data.customerId;
    if (user.role === "customer") {
      if (!parsed.data.barberId) return Response.json({ success: false, message: "Choose a barber" }, { status: 400 });
      const customer = await findCustomerByUserId(pool, user.id);
      if (!customer) return Response.json({ success: false, message: "Customer profile not found" }, { status: 404 });
      customerId = customer.id;
    }
    if (!customerId) {
      return Response.json({ success: false, message: "Choose a customer" }, { status: 400 });
    }

    // Every booking is held with a deposit. Customers pay ahead and give the
    // reference staff will verify; staff record how they collected it.
    const service = await findServiceById(pool, parsed.data.serviceId);
    if (service && bookingDeposit(service.price) > 0) {
      const deposit = parsed.data.deposit;
      if (!deposit) return Response.json({ success: false, message: "A deposit is required to book. Choose how it was paid" }, { status: 400 });
      if (user.role === "customer" && !["e_wallet", "bank_transfer"].includes(deposit.method))
        return Response.json({ success: false, message: "Pay the deposit by e-wallet or bank transfer" }, { status: 400 });
      if (user.role === "customer" && !deposit.reference?.trim())
        return Response.json({ success: false, message: "Enter the reference number of your deposit payment" }, { status: 400 });
    }

    const branchId = await visitBranch(pool, user, request);
    // Customer requests wait for staff approval; staff-entered bookings are confirmed on entry.
    const booking = await createBooking(pool, { ...parsed.data, customerId, branchId, status: user.role === "customer" ? "pending" : "confirmed",
      actor: { id: user.id, name: `${user.firstName} ${user.lastName}` } });
    return Response.json({ success: true, booking }, { status: 201 });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof BookingServiceError) {
      const status = error.kind === "conflict" || error.kind === "unavailable" ? 409 : 400;
      return Response.json({ success: false, message: error.message }, { status });
    }
    console.error("Unable to create booking", error);
    return Response.json({ success: false, message: "Unable to create booking" }, { status: 500 });
  }
}
