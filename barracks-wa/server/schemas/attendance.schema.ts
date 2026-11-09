import { z } from "zod";
import { textSchema } from "@/server/schemas/text.schema";

export const attendanceStatus = z.enum(["present", "late", "absent"]);
export const attendanceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark"), status: attendanceStatus }).strict(),
  z.object({ action: z.literal("clock_in") }).strict(),
  z.object({ action: z.literal("clock_out") }).strict(),
]);

export const attendanceHistorySchema = z.object({
  barberId: z.coerce.number().int().positive().optional(),
  date: z.iso.date().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  status: attendanceStatus.optional(),
}).strict();

export const attendanceCorrectionSchema = z.object({
  status: attendanceStatus,
  clockIn: z.iso.datetime({ offset: true }).nullable(),
  clockOut: z.iso.datetime({ offset: true }).nullable(),
  reason: textSchema("Reason", 1000, { required: true, multiline: true }),
}).strict().refine((value) => !value.clockOut || Boolean(value.clockIn && Date.parse(value.clockOut) >= Date.parse(value.clockIn)), {
  message: "Clock-out requires a clock-in and cannot precede it",
  path: ["clockOut"],
}).refine((value) => value.status !== "absent" || (!value.clockIn && !value.clockOut), {
  message: "Absent attendance cannot have clock times",
  path: ["status"],
});
