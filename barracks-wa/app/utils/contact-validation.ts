// Shared contact rules for every form and API schema, so the browser and the
// server accept and reject exactly the same values.

// Plain ASCII addresses only. Emoji and other non-ASCII characters are rejected,
// including domains a browser silently rewrote to punycode ("xn--").
const EMAIL_PATTERN =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export const EMAIL_MESSAGE =
  "Enter a valid email address using letters, numbers, and . _ % + - only";

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return (
    email.length <= 320 &&
    EMAIL_PATTERN.test(email) &&
    !/(^|[@.])xn--/i.test(email) &&
    !email.includes("..")
  );
}

// Philippine numbers, digits only: 11-digit mobile (09XXXXXXXXX) or a 7–10 digit landline.
export const PHONE_MESSAGE =
  "Enter a valid contact number: an 11-digit mobile number starting with 09, or a 7–10 digit landline (digits only)";

export function isValidPhone(value: string): boolean {
  const phone = value.trim();
  if (!/^\d+$/.test(phone)) return false;
  if (phone.length === 11) return phone.startsWith("09");
  return phone.length >= 7 && phone.length <= 10;
}

// Inline field errors: nothing while empty, the rule once something invalid is typed.
export function emailFieldError(value: string): string | undefined {
  return value.trim() && !isValidEmail(value) ? EMAIL_MESSAGE : undefined;
}

export function phoneFieldError(value: string): string | undefined {
  return value.trim() && !isValidPhone(value) ? PHONE_MESSAGE : undefined;
}
