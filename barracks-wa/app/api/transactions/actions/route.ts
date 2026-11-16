import { z } from "zod";
import { requireManagementUser } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { financialActionSchema, voidVisitSchema } from "@/server/schemas/payment.schema";
import { applyFinancialAction, PaymentServiceError, voidVisitBalance } from "@/server/services/payment.service";

export const runtime = "nodejs";

const requestSchema = financialActionSchema.extend({ reference: z.string().min(1).max(64) });

export async function POST(request: Request) {
  const user = await requireManagementUser();
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ success: false, message: "Invalid financial action" }, { status: 400 }); }
  // { visit, reason } voids the unpaid balance of a completed visit.
  if (body && typeof body === "object" && "visit" in body) {
    const visitVoid = voidVisitSchema.safeParse(body);
    if (!visitVoid.success) return Response.json({ success: false, message: "A visit and a reason are required to void" }, { status: 400 });
    try {
      return Response.json({ success: true, void: await voidVisitBalance(pool, visitVoid.data.visit, visitVoid.data.reason, user.id) });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return Response.json({ success: false, message: error.message },
          { status: error.kind === "forbidden" ? 403 : error.kind === "not_found" ? 404 : 409 });
      }
      console.error("Unable to void visit", error);
      return Response.json({ success: false, message: "Unable to void this visit" }, { status: 500 });
    }
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ success: false, message: "A valid full amount and reason are required" }, { status: 400 });
  const { reference, ...input } = parsed.data;
  try {
    return Response.json({ success: true, transaction: await applyFinancialAction(pool, reference, input, user.id) });
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      return Response.json({ success: false, message: error.message },
        { status: error.kind === "forbidden" ? 403 : error.kind === "not_found" ? 404 : 409 });
    }
    console.error("Unable to apply financial action", error);
    return Response.json({ success: false, message: "Unable to apply financial action" }, { status: 500 });
  }
}
