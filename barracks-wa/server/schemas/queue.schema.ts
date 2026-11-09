import { z } from "zod";
import { optionalPhoneSchema, personNameSchema } from "@/server/schemas/text.schema";

const walkInFields = {
  serviceId: z.string().trim().min(1).max(80),
  barberId: z.number().int().positive().nullable().optional(),
  idempotencyKey: z.uuid(),
};

export const walkInSchema = z.union([
  z.object({
    ...walkInFields,
    customerId: z.number().int().positive(),
  }).strict(),
  z.object({
    ...walkInFields,
    customer: z.object({
      firstName: personNameSchema("First name"),
      lastName: personNameSchema("Last name"),
      phone: optionalPhoneSchema.default(""),
    }).strict(),
  }).strict(),
]);
export type WalkInInput = z.infer<typeof walkInSchema>;

export const queueChangeSchema = z.union([
  z.object({ barberId: z.number().int().positive().nullable() }).strict(),
  z.object({ status: z.enum(["waiting", "ready", "in_progress", "completed", "removed"]) }).strict(),
]);
export const nextCustomerConfirmSchema = z.object({
  barberId: z.number().int().positive(), entryId: z.number().int().positive(),
}).strict();
