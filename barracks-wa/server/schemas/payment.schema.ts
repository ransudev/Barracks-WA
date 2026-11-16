import { z } from "zod";
import { textSchema } from "@/server/schemas/text.schema";

export const paymentMethodSchema = z.enum(["cash", "card", "e_wallet", "bank_transfer", "other"]);
export const paymentStatusSchema = z.enum(["pending", "completed", "failed", "voided", "partially_refunded", "refunded", "unknown"]);

const visitSchema = z.union([
  z.object({ bookingId: z.number().int().positive() }).strict(),
  z.object({ queueEntryId: z.number().int().positive() }).strict(),
]);

const cashReceivedSchema = z.number().finite().nonnegative().max(9_999_999_999.99)
  .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "Use at most two decimal places");

// One visit, or several of the same customer paid together on one receipt.
// amountReceived below the balance records a partial payment (one visit only).
const visitsSchema = z.array(visitSchema).min(1).max(10);
const targetRefine = (value: { visit?: unknown; visits?: unknown }) => (value.visit === undefined) !== (value.visits === undefined);
const targetMessage = { message: "Choose the visit or visits to pay", path: ["visit"] };
export const createTransactionSchema = z.union([
  z.object({ visit: visitSchema.optional(), visits: visitsSchema.optional(), paymentMethod: z.literal("cash"), amountReceived: cashReceivedSchema }).strict().refine(targetRefine, targetMessage),
  z.object({ visit: visitSchema.optional(), visits: visitsSchema.optional(), paymentMethod: z.enum(["card", "e_wallet", "bank_transfer", "other"]), amountReceived: cashReceivedSchema.optional() }).strict().refine(targetRefine, targetMessage),
]);

// Manager void of an unpaid or underpaid visit; the reason is always logged.
export const voidVisitSchema = z.object({
  visit: visitSchema,
  reason: textSchema("Reason", 500, { required: true, multiline: true }),
}).strict();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const financialActionSchema = z.object({
  // Refund was retired in favour of Void.
  action: z.literal("void"),
  reason: textSchema("Reason", 500, { required: true, multiline: true }),
  amount: z.number().finite().positive().max(9_999_999_999.99)
    .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "Use at most two decimal places"),
}).strict();
export type FinancialActionInput = z.infer<typeof financialActionSchema>;

const dateSchema = z.iso.date();
export const transactionHistorySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: textSchema("Search", 100).default(""),
  paymentMethod: paymentMethodSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: "End date must be on or after start date", path: ["dateTo"],
});
export type TransactionHistoryInput = z.infer<typeof transactionHistorySchema>;
