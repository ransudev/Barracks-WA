// Shared text rules for every form and API schema, so the browser and the
// server accept and reject exactly the same values (see contact-validation.ts
// for email and phone).

// Control characters are never typed by a person; they usually come from a bad
// paste or a crafted request. Multi-line fields keep tabs and line breaks.
const SINGLE_LINE_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
// Zero-width and other invisible characters do not count as content.
const INVISIBLE = /[\s\u00AD\u180E\u200B-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/gu;

export const CONTROL_CHARACTER_MESSAGE =
  "contains invisible control characters; retype it or paste it as plain text";

export function hasControlCharacters(value: string, multiline = false): boolean {
  return (multiline ? MULTI_LINE_CONTROL : SINGLE_LINE_CONTROL).test(value);
}

export function hasVisibleText(value: string): boolean {
  return value.replace(INVISIBLE, "").length > 0;
}

// People's names: any alphabet's letters (ñ, é, ü, 李, ...), with the joining
// marks real names use: spaces, apostrophes (O'Neil, D’Souza), hyphens
// (Reyes-Santos) and periods (Ma. Cristina, Jr.). A name must start with a
// letter; digits and other symbols are rejected.
const PERSON_NAME_PATTERN = /^\p{L}[\p{L}\p{M} '’.-]*$/u;
export const PERSON_NAME_MAX = 100;

export function personNameMessage(label: string): string {
  return `${label} can only use letters, spaces, apostrophes ('), hyphens (-), and periods (.), and must start with a letter`;
}

// Collapses repeated spaces so "Juan  Dela   Cruz" is stored once, cleanly.
export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidPersonName(value: string): boolean {
  const name = normalizePersonName(value);
  return name.length > 0 && name.length <= PERSON_NAME_MAX && PERSON_NAME_PATTERN.test(name);
}

// Inline field errors: nothing while empty (the required marker covers that),
// the rule once something invalid is typed.
export function personNameFieldError(value: string, label: string): string | undefined {
  const name = normalizePersonName(value);
  if (!name) return undefined;
  if (name.length > PERSON_NAME_MAX)
    return `${label} must be ${PERSON_NAME_MAX} characters or fewer`;
  return PERSON_NAME_PATTERN.test(name) ? undefined : personNameMessage(label);
}
