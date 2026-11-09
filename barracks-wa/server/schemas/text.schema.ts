import "@/server/schemas/messages";
import { z } from "zod";
import { PHONE_INPUT_MAX, PHONE_MESSAGE, isValidPhone, normalizePhone } from "@/app/utils/contact-validation";
import {
  CONTROL_CHARACTER_MESSAGE,
  PERSON_NAME_MAX,
  hasControlCharacters,
  hasVisibleText,
  isValidPersonName,
  normalizePersonName,
  personNameMessage,
} from "@/app/utils/text-validation";

// Building blocks for every free-text field. Symbols, digits, accents and
// emoji stay allowed in ordinary text (shop names, notes, references); only
// control characters and invisible-only values are rejected.

type TextOptions = { required?: boolean; multiline?: boolean };

export function textSchema(label: string, max: number, { required = false, multiline = false }: TextOptions = {}) {
  let schema = z.string().trim().max(max, `${label} must be ${max} characters or fewer`)
    .refine((value) => !hasControlCharacters(value, multiline), `${label} ${CONTROL_CHARACTER_MESSAGE}`);
  if (required) schema = schema.refine(hasVisibleText, `${label} is required`);
  return schema;
}

// People's names (customers, staff, barbers). Repeated spaces are collapsed.
export function personNameSchema(label: string) {
  return z.string().transform(normalizePersonName).pipe(
    z.string()
      .min(1, `${label} is required`)
      .max(PERSON_NAME_MAX, `${label} must be ${PERSON_NAME_MAX} characters or fewer`)
      .refine(isValidPersonName, personNameMessage(label)),
  );
}

// Optional contact number, stored as plain digits whatever formatting was typed.
export const optionalPhoneSchema = z.string().trim()
  .max(PHONE_INPUT_MAX, `Phone number must be ${PHONE_INPUT_MAX} characters or fewer`)
  .refine((value) => !value || isValidPhone(value), PHONE_MESSAGE)
  .transform((value) => (value ? normalizePhone(value) : ""));
