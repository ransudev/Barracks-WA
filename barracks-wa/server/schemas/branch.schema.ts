import { z } from "zod";
import { optionalPhoneSchema, textSchema } from "@/server/schemas/text.schema";

export const branchIdSchema = z.coerce.number().int().positive().max(2147483647);
export const branchSchema = z.object({
  name: textSchema("Branch name", 160, { required: true }),
  code: z.string().trim().toUpperCase().min(1, "Branch code is required").max(40, "Branch code must be 40 characters or fewer")
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Branch code can only use letters, numbers, hyphens (-), and underscores (_), and must start with a letter or number"),
  address: textSchema("Address", 500).default(""),
  phone: optionalPhoneSchema.default(""),
  status: z.enum(["active", "inactive"]).default("active"),
}).strict();
export const branchUpdateSchema = z.object({
  name: branchSchema.shape.name.optional(),
  code: branchSchema.shape.code.optional(),
  address: textSchema("Address", 500).optional(),
  phone: optionalPhoneSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "Provide a branch field");
export const branchAssignmentSchema = z.object({ userId: z.number().int().positive().max(2147483647), isPrimary: z.boolean().default(false) }).strict();
export const branchPrimarySchema = z.object({ isPrimary: z.literal(true) }).strict();
export type BranchInput = z.infer<typeof branchSchema>;
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>;
