import { z } from "zod";
import { textSchema } from "@/server/schemas/text.schema";

export const serviceIdSchema = z.string().max(80, "Service ID must be 80 characters or fewer")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Service ID can only use lowercase letters, numbers, and single hyphens");
export const serviceSchema = z.object({
  id: serviceIdSchema,
  name: textSchema("Service name", 160, { required: true }),
  description: textSchema("Description", 500, { multiline: true }),
  price: z.number().finite().min(0).max(9999999999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Use up to 2 decimal places"),
  durationMinutes: z.number().int("Duration must be a whole number of minutes").positive("Duration must be at least 1 minute").max(2147483647),
  active: z.boolean(),
  // What the package includes, shown to customers when they book.
  inclusions: z.array(textSchema("Inclusion", 80, { required: true })).max(12).optional(),
}).strict();
export const serviceUpdateSchema = serviceSchema.omit({ id: true }).partial().strict();
export type ServiceInput = z.infer<typeof serviceSchema>;
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;
