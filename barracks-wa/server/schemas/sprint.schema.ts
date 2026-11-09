import { z } from "zod";
import { emailSchema, formatValidationErrors } from "@/server/schemas/user.schema";
import { optionalPhoneSchema, personNameSchema, textSchema } from "@/server/schemas/text.schema";

export { formatValidationErrors };

export const barberStatusSchema = z.enum(["available", "busy", "unavailable"]);
export const inventoryCategorySchema = z.enum(["Supplies", "Equipment", "Products"]);
export const bookingStatusSchema = z.enum(["pending", "confirmed", "rejected", "checked_in", "in_progress", "completed", "cancelled", "no_show"]);

const percentageSchema = z
  .number()
  .finite()
  .min(0, "Commission rate cannot be negative")
  .max(100, "Commission rate cannot exceed 100")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Use up to 2 decimal places");

const ratingSchema = z
  .number()
  .finite()
  .min(0, "Rating cannot be negative")
  .max(5, "Rating cannot exceed 5")
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-8, "Use up to 1 decimal place");

const loyaltyPointsSchema = z
  .number()
  .finite()
  .int("Loyalty points must be a whole number")
  .min(0, "Loyalty points cannot be negative")
  .max(2147483647, "Loyalty points are too large");

const moneySchema = z
  .number()
  .finite()
  .min(0, "Value cannot be negative")
  .max(9999999999.99, "Value is too large")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Use up to 2 decimal places");

const bookingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid booking date")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Choose a valid booking date");

const bookingTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid booking time");

export const barberSchema = z
  .object({
    branchId: z.number().int().positive(),
    firstName: personNameSchema("First name"),
    lastName: personNameSchema("Last name"),
    status: barberStatusSchema,
    commissionRate: percentageSchema.nullable(),
    rating: ratingSchema.nullable().optional(),
  })
  .strict();

export const barberStaffSchema = barberSchema.omit({ commissionRate: true, rating: true }).strict();

export const inventoryItemSchema = z
  .object({
    name: textSchema("Item name", 160, { required: true }),
    category: inventoryCategorySchema,
    branch: textSchema("Branch", 120, { required: true }).default("Main Branch"),
    quantity: z.number().finite().int().min(0, "Quantity cannot be negative").max(2147483647, "Quantity is too large"),
    minimumStock: z.number().finite().int().min(0, "Minimum stock cannot be negative").max(2147483647, "Minimum stock is too large"),
    unitCost: moneySchema,
  })
  .strict();

export const barberCommissionSchema = z
  .object({
    commissionRate: percentageSchema,
  })
  .strict();

export const bookingCreateSchema = z
  .object({
    customerId: z.number().int().positive().optional(),
    barberId: z.number().int().positive().nullable().optional(),
    serviceId: z.string().trim().min(1).max(80),
    date: bookingDateSchema,
    time: bookingTimeSchema,
    notes: textSchema("Notes", 500, { multiline: true }).nullable().optional(),
  })
  .strict();

export const bookingUpdateSchema = z
  .object({
    status: z.enum(["confirmed", "rejected", "checked_in", "in_progress", "completed", "cancelled", "no_show"]),
  })
  .strict();

export const bookingEditSchema = z
  .object({
    customerId: z.number().int().positive(),
    barberId: z.number().int().positive().nullable().optional(),
    serviceId: z.string().trim().min(1).max(80),
    date: bookingDateSchema,
    time: bookingTimeSchema,
    notes: textSchema("Notes", 500, { multiline: true }).nullable().optional(),
  })
  .strict();

export const customerBookingEditSchema = bookingEditSchema.omit({ customerId: true }).strict();

// Optional for customers; when given it must be a real contact number.
const phoneSchema = optionalPhoneSchema;

export const customerSignupSchema = z
  .object({
    firstName: personNameSchema("First name"),
    lastName: personNameSchema("Last name"),
    email: emailSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be 128 characters or fewer"),
    phone: phoneSchema.default(""),
    preferredBarberId: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const customerProfileSchema = z
  .object({
    firstName: personNameSchema("First name"),
    lastName: personNameSchema("Last name"),
    email: emailSchema,
    phone: phoneSchema,
    preferredBarberId: z.number().int().positive().nullable(),
    loyaltyPoints: loyaltyPointsSchema.optional(),
  })
  .strict();

export const customerSelfProfileSchema = customerProfileSchema.omit({ loyaltyPoints: true }).strict();
export const customerStaffProfileSchema = customerSelfProfileSchema;
export const walkinCustomerProfileSchema = customerProfileSchema.omit({ email: true }).strict();
export const walkinCustomerStaffProfileSchema = walkinCustomerProfileSchema.omit({ loyaltyPoints: true }).strict();

export type BarberInput = z.infer<typeof barberSchema>;
export type BarberStaffInput = z.infer<typeof barberStaffSchema>;
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
export type BookingUpdateInput = z.infer<typeof bookingUpdateSchema>;
export type BookingEditInput = z.infer<typeof bookingEditSchema>;
export type CustomerBookingEditInput = z.infer<typeof customerBookingEditSchema>;
export type CustomerSignupInput = z.infer<typeof customerSignupSchema>;
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;
export type WalkinCustomerProfileInput = z.infer<typeof walkinCustomerProfileSchema>;
