import { z } from "zod";
import { requireSupplierUser } from "@/server/auth/require-role";
import { getSessionToken } from "@/server/auth/session";
import { pool } from "@/server/db/pool";
import { inTransaction } from "@/server/db/transaction";
import { hashPassword, verifyPassword } from "@/server/services/password.service";
import { deleteOtherSessions } from "@/server/services/session.service";

export const runtime = "nodejs";

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
}).strict().refine((data) => data.currentPassword !== data.newPassword, {
  path: ["newPassword"],
  message: "New password must be different from the current password",
});

export async function PATCH(request: Request) {
  const user = await requireSupplierUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: "Invalid account settings" }, { status: 400 });
  }

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid account settings",
    }, { status: 400 });
  }

  try {
    const current = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1 AND deleted_at IS NULL LIMIT 1",
      [user.id],
    );
    if (!current.rows[0]) {
      return Response.json({ success: false, message: "Account not found" }, { status: 404 });
    }
    if (!(await verifyPassword(parsed.data.currentPassword, current.rows[0].password_hash))) {
      return Response.json({ success: false, message: "Current password is incorrect" }, { status: 400 });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    const currentSession = await getSessionToken();
    await inTransaction(pool, async (client) => {
      await client.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2", [passwordHash, user.id]);
      await deleteOtherSessions(client, user.id, currentSession);
    });
    return Response.json({ success: true, message: "Password updated" });
  } catch (error) {
    console.error("Unable to update supplier account", error);
    return Response.json({ success: false, message: "Unable to update account settings" }, { status: 500 });
  }
}
