import { z } from "zod";
import { userRoles } from "@/app/constants/roles";
import { EMAIL_MESSAGE, isValidEmail } from "@/app/utils/contact-validation";
import { personNameSchema } from "@/server/schemas/text.schema";

export const emailSchema = z.string().trim().toLowerCase().max(320).refine(isValidEmail, EMAIL_MESSAGE);

export const userRoleSchema = z.enum(userRoles);
export const staffRoleSchema = z.enum(["administrator", "manager", "front_desk"]);

export const createUserSchema = z
  .object({
    firstName: personNameSchema("First name"),
    lastName: personNameSchema("Last name"),
    email: emailSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be 128 characters or fewer"),
    role: userRoleSchema,
  })
  .strict();

export const createStaffUserSchema = createUserSchema.extend({
  role: staffRoleSchema,
  branchIds: z.array(z.number().int().positive()).max(100).refine(ids => new Set(ids).size === ids.length, "Branches must be unique").default([]),
});

export const updateStaffUserSchema = z
  .object({
    firstName: personNameSchema("First name"),
    lastName: personNameSchema("Last name"),
    email: emailSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be 128 characters or fewer").optional(),
    role: staffRoleSchema,
  })
  .strict();

export const userLifecycleSchema = z
  .object({
    action: z.enum(["verify", "unverify", "block", "unblock"]),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "Password is required").max(128, "Password must be 128 characters or fewer"),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateStaffUserInput = z.infer<typeof updateStaffUserSchema>;
export type UserLifecycleInput = z.infer<typeof userLifecycleSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;

export type ValidationErrors = Record<string, string[]>;

export function formatValidationErrors(error: z.ZodError): ValidationErrors {
  return error.issues.reduce<ValidationErrors>((errors, issue) => {
    const field = issue.path[0]?.toString() ?? "form";
    errors[field] ??= [];
    errors[field].push(issue.message);
    return errors;
  }, {});
}
