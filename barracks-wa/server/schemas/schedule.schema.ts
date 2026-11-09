import { z } from "zod";
import { textSchema } from "@/server/schemas/text.schema";

export const daySchema = z.number().int().min(0).max(6);
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time (HH:MM)");
export const dateSchema = z.iso.date();
export const hoursSchema = z.object({ dayOfWeek: daySchema, openTime: timeSchema, closeTime: timeSchema, isClosed: z.boolean() }).strict()
  .refine((value) => value.openTime < value.closeTime, { message: "Closing time must follow opening time", path: ["closeTime"] });
export const breakSchema = z.object({ startTime: timeSchema, endTime: timeSchema }).strict()
  .refine((value) => value.startTime < value.endTime, { message: "Break end must follow start", path: ["endTime"] });
export const weeklyScheduleSchema = z.object({ dayOfWeek: daySchema, isWorking: z.boolean(), startTime: timeSchema, endTime: timeSchema, breaks: z.array(breakSchema).max(12) }).strict()
  .superRefine((value, context) => {
    if (value.startTime >= value.endTime) context.addIssue({ code: "custom", message: "Shift end must follow start", path: ["endTime"] });
    const sorted = [...value.breaks].sort((a, b) => a.startTime.localeCompare(b.startTime));
    sorted.forEach((item, index) => {
      if (item.startTime < value.startTime || item.endTime > value.endTime) context.addIssue({ code: "custom", message: "Break must be inside shift", path: ["breaks", index] });
      if (index && item.startTime < sorted[index - 1].endTime) context.addIssue({ code: "custom", message: "Breaks cannot overlap", path: ["breaks", index] });
    });
  });
export const unavailabilitySchema = z.object({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), reason: textSchema("Reason", 200, { required: true }) }).strict()
  .refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt), { message: "End must follow start", path: ["endsAt"] });
export const availabilityQuerySchema = z.object({ serviceId: z.string().trim().min(1).max(80), barberId: z.coerce.number().int().positive().optional(), date: dateSchema, excludeBookingId: z.coerce.number().int().positive().optional() }).strict();
