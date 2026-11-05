import { z } from "zod";
import { branchErrorResponse } from "@/server/auth/branch-access";
import { formatValidationErrors } from "@/server/schemas/user.schema";

export async function readBranchInput<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, message: "Invalid branch information" },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? parsed.data
    : Response.json(
        {
          success: false,
          message: "Check the branch information",
          errors: formatValidationErrors(parsed.error),
        },
        { status: 400 },
      );
}
export function branchApiError(error: unknown): Response {
  const branchResponse = branchErrorResponse(error);
  if (branchResponse) return branchResponse;
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "23505")
      return Response.json(
        { success: false, message: "Branch code or staff assignment already exists" },
        { status: 409 },
      );
    if (error.code === "23514") {
      const triggerMessage =
        !("constraint" in error && error.constraint) &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : null;
      return Response.json(
        { success: false, message: triggerMessage ?? "Invalid branch or staff assignment" },
        { status: 400 },
      );
    }
  }
  console.error("Unable to process branch request", error);
  return Response.json(
    { success: false, message: "Unable to process branch request" },
    { status: 500 },
  );
}
export const branchNotFound = () =>
  Response.json({ success: false, message: "Branch or assignment not found" }, { status: 404 });
