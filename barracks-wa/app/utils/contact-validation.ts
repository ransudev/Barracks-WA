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
    !email.includes("..") &&
    // The part before "@" cannot start or end with a dot (".john@" or "john.@").
    !/^\.|\.@/.test(email)
  );
}

// Philippine numbers: 11-digit mobile (09XXXXXXXXX) or a 7–10 digit landline.
// People type them many ways ("0917 123 4567", "+63 917-123-4567",
// "(02) 8123 4567"), so spacing and punctuation are accepted and removed, and
// the +63 country code becomes the local 0 before the digits are checked.
export const PHONE_MESSAGE =
  "Enter a valid contact number: an 11-digit mobile number starting with 09 or +63 9, or a 7–10 digit landline. Spaces, dashes, dots, and parentheses are fine";

// The longest formatted number worth typing, e.g. "+63 (917) 123-4567".
export const PHONE_INPUT_MAX = 20;

export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const international = /^\+63(\d{7,10})$/.exec(compact);
  if (international) return `0${international[1]}`;
  // Without the "+", only a full mobile number is unambiguous (63 9XX XXX XXXX).
  if (/^639\d{9}$/.test(compact)) return `0${compact.slice(2)}`;
  return compact;
}

export function isValidPhone(value: string): boolean {
  if (value.trim().length > PHONE_INPUT_MAX) return false;
  const phone = normalizePhone(value);
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
