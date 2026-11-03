import { z } from "zod";
import { visitBranch, visitBranchError } from "@/server/auth/branch-access";
import { requireRolesUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { AvailabilityError, getMonthAvailability } from "@/server/services/booking-availability.service";
import { findBookingById } from "@/server/services/booking.service";
import { findCustomerByUserId } from "@/server/services/customer.service";

export const runtime = "nodejs";

const monthQuerySchema = z.object({
  serviceId: z.string().trim().min(1).max(80),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  barberId: z.coerce.number().int().positive().optional(),
  excludeBookingId: z.coerce.number().int().positive().optional(),
  branchId: z.string().optional(),
}).strict();

// Month overview for booking calendars: open start times per day plus why a day is closed.
export async function GET(request: Request) {
  const actor = await requireRolesUser(["customer", "front_desk", "manager", "administrator"]);
  if (actor instanceof Response) return actor;
  const parsed = monthQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ success: false, message: "Invalid availability request" }, { status: 400 });
  try {
    const branchId = await visitBranch(pool, actor, request);
    if (parsed.data.excludeBookingId) {
      const booking = await findBookingById(pool, parsed.data.excludeBookingId);
      if (!booking || booking.branchId !== branchId || (actor.role === "customer" && (await findCustomerByUserId(pool, actor.id))?.id !== booking.customerId)) {
        return Response.json({ success: false, message: "Booking not found" }, { status: 404 });
      }
    }
    const days = await getMonthAvailability(pool, { ...parsed.data, branchId }, { excludeBookingId: parsed.data.excludeBookingId });
    return Response.json({ success: true, month: parsed.data.month, days }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const branchResponse = visitBranchError(error);
    if (branchResponse) return branchResponse;
    if (error instanceof AvailabilityError) return Response.json({ success: false, message: error.message }, { status: 404 });
    console.error("Unable to load month availability", error);
    return Response.json({ success: false, message: "Unable to load availability" }, { status: 500 });
  }
}
