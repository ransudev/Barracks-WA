import { z } from "zod";
import { emailSchema } from "@/server/schemas/user.schema";
import { requireAdministrator } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { hashPassword } from "@/server/services/password.service";
import { parseRouteId } from "@/server/schemas/route-id";

export const runtime = "nodejs";
const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: z.string().min(8).max(128),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdministrator(); if (denied) return denied;
  const supplierId = parseRouteId((await params).id); if (!supplierId) return Response.json({success:false,message:"Invalid supplier id"},{status:400});
  let body: unknown; try { body = await request.json(); } catch { return Response.json({success:false,message:"Invalid supplier account information"},{status:400}); }
  const parsed = schema.safeParse(body); if (!parsed.success) return Response.json({success:false,message:"Invalid supplier account information"},{status:400});
  // Hash first: this is slow and must not hold a connection or transaction open.
  const passwordHash = await hashPassword(parsed.data.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const supplier = await client.query("SELECT id FROM suppliers WHERE id=$1",[supplierId]);
    if (!supplier.rows[0]) throw new Error("SUPPLIER_NOT_FOUND");
    const linked = await client.query("SELECT user_id FROM supplier_accounts WHERE supplier_id=$1",[supplierId]);
    if (linked.rows[0]) throw new Error("ACCOUNT_EXISTS");
    const duplicate = await client.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL",[parsed.data.email]);
    if (duplicate.rows[0]) throw new Error("DUPLICATE_EMAIL");
    const role = await client.query<{id:number}>("SELECT id FROM roles WHERE name='supplier' LIMIT 1");
    if (!role.rows[0]) throw new Error("SUPPLIER_ROLE_MISSING");
    const inserted = await client.query<{id:number}>(`INSERT INTO users
      (first_name,last_name,email,password_hash,role_id,is_verified,is_blocked)
      VALUES ($1,$2,$3,$4,$5,TRUE,FALSE) RETURNING id`,
      [parsed.data.firstName,parsed.data.lastName,parsed.data.email,passwordHash,role.rows[0].id]);
    await client.query("INSERT INTO supplier_accounts (user_id,supplier_id) VALUES ($1,$2)",[inserted.rows[0].id,supplierId]);
    await client.query("COMMIT");
    return Response.json({success:true,userId:inserted.rows[0].id},{status:201});
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    const code = error instanceof Error ? error.message : "";
    const expected: Record<string, string> = {
      ACCOUNT_EXISTS: "This supplier already has an account",
      DUPLICATE_EMAIL: "That email is already in use",
      SUPPLIER_NOT_FOUND: "Supplier not found",
    };
    const isUniqueViolation = (error as { code?: string } | null)?.code === "23505";
    const message = isUniqueViolation ? expected.DUPLICATE_EMAIL : expected[code];
    if (message) return Response.json({ success: false, message }, { status: 400 });
    console.error("Unable to create supplier account", error);
    return Response.json({ success: false, message: "Unable to create supplier account" }, { status: 500 });
  } finally { client.release(); }
}
