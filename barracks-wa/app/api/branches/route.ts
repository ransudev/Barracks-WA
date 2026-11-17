import { requireAdministrator } from "@/server/auth/require-role";
import { pool } from "@/server/db/pool";
import { branchSchema } from "@/server/schemas/branch.schema";
import { createBranch, listBranches, listBranchStaff } from "@/server/services/branch.service";
import { branchApiError, readBranchInput } from "@/server/services/branch-api";

export const runtime = "nodejs";
export async function GET() {
  const denied = await requireAdministrator(); if (denied) return denied;
  try {
    const [branches, staff] = await Promise.all([listBranches(pool, false, true), listBranchStaff(pool)]);
    return Response.json({ success: true, branches, staff });
  } catch (error) { return branchApiError(error); }
}
export async function POST(request: Request) {
  const denied = await requireAdministrator(); if (denied) return denied;
  const input = await readBranchInput(request, branchSchema); if (input instanceof Response) return input;
  try { return Response.json({ success: true, branch: await createBranch(pool, input) }, { status: 201 }); }
  catch (error) { return branchApiError(error); }
}
