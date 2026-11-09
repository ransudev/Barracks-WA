import { z } from "zod";
import { textSchema } from "@/server/schemas/text.schema";

const id = z.number().int().positive();
const rate = z.string().regex(/^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/, "Use a percentage from 0 to 100 with up to two decimal places");
const reason = textSchema("Reason", 500, { required: true, multiline: true });
export const payrollCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), branchId: id, anchorDate: z.iso.date() }).strict(),
  z.object({ action: z.literal("rate"), branchId: id, barberId: id, rate, effectiveAt: z.iso.datetime({ offset: true }).optional(), reason }).strict(),
  z.object({ action: z.literal("correct_snapshot"), branchId: id, snapshotId: id, rate, reason }).strict(),
  z.object({ action: z.literal("generate"), branchId: id, periodStart: z.iso.date() }).strict(),
  z.object({ action: z.literal("supplement"), branchId: id, recordId: id, reason }).strict(),
  z.object({ action: z.literal("adjust"), branchId: id, recordId: id, sourceRecordId: id.optional(), amountCentavos: z.string().regex(/^-?[1-9]\d{0,11}$/, "Enter a non-zero amount in whole centavos"), reason }).strict(),
  z.object({ action: z.literal("submit"), branchId: id, recordId: id }).strict(),
  z.object({ action: z.literal("return"), branchId: id, recordId: id, reason }).strict(),
  z.object({ action: z.literal("approve"), branchId: id, recordId: id }).strict(),
  z.object({ action: z.literal("pay"), branchId: id, recordId: id, paidAt: z.iso.datetime({ offset: true }), paymentMethod: z.enum(["cash", "bank_transfer", "e_wallet"]), reference: textSchema("Reference", 160).optional() }).strict(),
]);
export type PayrollCommand = z.infer<typeof payrollCommandSchema>;
export const payrollQuerySchema = z.object({
  branchId: z.coerce.number().int().positive(),
  recordId: z.coerce.number().int().positive().optional(),
  periodStart: z.iso.date().optional(),
  barberId: z.coerce.number().int().positive().optional(),
  status: z.enum(["draft", "pending_approval", "approved", "paid"]).optional(),
  search: textSchema("Search", 100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type PayrollQuery = z.infer<typeof payrollQuerySchema>;
