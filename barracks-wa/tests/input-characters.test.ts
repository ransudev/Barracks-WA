import assert from "node:assert/strict";
import test from "node:test";
import { createStaffUserSchema, loginSchema } from "@/server/schemas/user.schema";
import { barberStaffSchema, bookingCreateSchema, customerSignupSchema, walkinCustomerStaffProfileSchema } from "@/server/schemas/sprint.schema";
import { walkInSchema } from "@/server/schemas/queue.schema";
import { branchSchema } from "@/server/schemas/branch.schema";
import { serviceSchema } from "@/server/schemas/service.schema";
import { inventoryCreateSchema, supplierSchema } from "@/server/schemas/sprint2.schema";
import { financialActionSchema, transactionHistorySchema } from "@/server/schemas/payment.schema";
import { unavailabilitySchema } from "@/server/schemas/schedule.schema";
import { isValidEmail, isValidPhone, normalizePhone, phoneFieldError } from "@/app/utils/contact-validation";
import { personNameFieldError } from "@/app/utils/text-validation";
import { createSlug } from "@/app/utils/format";
import { formatValidationErrors } from "@/server/schemas/user.schema";

// Built from code points so no editor or formatter can silently alter them.
const NUL = String.fromCodePoint(0);
const BELL = String.fromCodePoint(7);
const ESC = String.fromCodePoint(0x1b);
const ZERO_WIDTH = String.fromCodePoint(0x200b);
const RIGHT_QUOTE = String.fromCodePoint(0x2019);

const staff = (firstName: string, lastName = "Cruz") => createStaffUserSchema.safeParse({
  firstName, lastName, email: "staff@example.com", password: "password123", role: "front_desk",
});
const messages = (result: { success: boolean; error?: Parameters<typeof formatValidationErrors>[0] }) =>
  result.success || !result.error ? [] : Object.values(formatValidationErrors(result.error)).flat();

test("person names accept real names from any alphabet and reject digits, symbols and markup", () => {
  for (const name of ["María José", "Niño", "O'Neil", `D${RIGHT_QUOTE}Souza`, "Reyes-Santos", "Ma. Cristina", "Jr.", "Zoë", "李", "Dela Cruz"]) {
    assert.equal(staff(name).success, true, name);
  }
  for (const name of ["John3", "<script>", "Juan@Cruz", "!!!", "-Ana", "'Ana", "Ana_Cruz", "Ana😀", `Ana${NUL}`, ZERO_WIDTH]) {
    assert.equal(staff(name).success, false, name);
  }
  // Repeated spaces are collapsed and the message names the field and the rule.
  const spaced = staff("  Juan   Carlos ");
  assert.equal(spaced.success && spaced.data.firstName, "Juan Carlos");
  assert.match(messages(staff("Juan2")).join(" "), /^First name can only use letters, spaces, apostrophes/);
  assert.match(messages(staff("Ana", "x".repeat(101))).join(" "), /Last name must be 100 characters or fewer/);
  assert.match(messages(staff("   ")).join(" "), /First name is required/);
});

test("every name field uses the same rule: barbers, signups, walk-ins and customer profiles", () => {
  assert.equal(barberStaffSchema.safeParse({ branchId: 1, firstName: "Ren#", lastName: "Ito", status: "available" }).success, false);
  assert.equal(barberStaffSchema.safeParse({ branchId: 1, firstName: "Renée", lastName: "D'Ito", status: "available" }).success, true);
  assert.equal(customerSignupSchema.safeParse({ firstName: "Ana", lastName: "1234", email: "ana@example.com", password: "password123" }).success, false);
  assert.equal(walkinCustomerStaffProfileSchema.safeParse({ firstName: "Ana", lastName: "Peña", phone: "", preferredBarberId: null }).success, true);
  const walkIn = { serviceId: "classic-cut", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" };
  assert.equal(walkInSchema.safeParse({ ...walkIn, customer: { firstName: "Ana", lastName: "Cruz$" } }).success, false);
  assert.equal(walkInSchema.safeParse({ ...walkIn, customer: { firstName: "Ana", lastName: "Cruz", phone: "0917-123-4567" } }).success, true);
  // The browser shows the same rule inline before submitting.
  assert.equal(personNameFieldError("", "First name"), undefined);
  assert.equal(personNameFieldError("Ana Marie", "First name"), undefined);
  assert.match(personNameFieldError("Ana2", "First name") ?? "", /^First name can only use letters/);
});

test("phone numbers accept common formatting, store plain digits, and reject letters and symbols", () => {
  const accepted: Record<string, string> = {
    "09171234567": "09171234567",
    "0917 123 4567": "09171234567",
    "0917-123-4567": "09171234567",
    "+63 917 123 4567": "09171234567",
    "639171234567": "09171234567",
    "(02) 8123 4567": "0281234567",
    "8123.4567": "81234567",
    "+63 2 8123 4567": "0281234567",
  };
  for (const [raw, stored] of Object.entries(accepted)) {
    assert.equal(isValidPhone(raw), true, raw);
    assert.equal(normalizePhone(raw), stored, raw);
    const parsed = customerSignupSchema.safeParse({ firstName: "Ana", lastName: "Cruz", email: "ana@example.com", password: "password123", phone: raw });
    assert.equal(parsed.success && parsed.data.phone, stored, raw);
  }
  for (const raw of ["0917ABC4567", "0917#123#4567", "+1 415 555 0100", "123", "08171234567", "0917 123 4567 8", "+63 917 123 4567 ext 2", "0917_123_4567"]) {
    assert.equal(isValidPhone(raw), false, raw);
  }
  assert.equal(phoneFieldError(""), undefined);
  assert.match(phoneFieldError("abc") ?? "", /Spaces, dashes, dots, and parentheses are fine/);
  // Branch phones follow the same rule (they used to accept any text).
  assert.equal(branchSchema.safeParse({ name: "North", code: "N1", phone: "call us" }).success, false);
  assert.equal(branchSchema.parse({ name: "North", code: "N1", phone: "(02) 8123-4567" }).phone, "0281234567");
});

test("emails keep the ASCII rule and also reject dots at the edge of the local part", () => {
  for (const email of ["ana.cruz@example.com", "ana+shop@example.ph", "a_b-c%d@sub.example.co"]) assert.equal(isValidEmail(email), true, email);
  for (const email of [".ana@example.com", "ana.@example.com", "ana..cruz@example.com", "añа@example.com", "ana cruz@example.com", "ana@example", "<ana>@example.com"]) {
    assert.equal(isValidEmail(email), false, email);
  }
});

test("passwords accept any printable characters, including spaces and symbols", () => {
  for (const password of ["p@ss w0rd!", "ñandú-ÄÖÜ-密码", "        ", `"'<>&;--`]) {
    assert.equal(loginSchema.safeParse({ email: "ana@example.com", password }).success, true, password);
  }
  assert.match(messages(loginSchema.safeParse({ email: "ana@example.com", password: "x".repeat(129) })).join(" "), /Password must be 128 characters or fewer/);
});

test("free text keeps symbols, digits and accents but rejects control characters and invisible-only values", () => {
  const supplier = (fields: Record<string, string>) => supplierSchema.safeParse({ companyName: "Bright & Co.", phone: "09171234567", ...fields });
  assert.equal(supplier({ companyName: "Bright & Co. (Pasig) #2 — 100% Filipino ✂️", notes: "Line one\nLine two\twith tab", address: "Unit 3/F, 12 Rizal St., Brgy. San José" }).success, true);
  assert.equal(supplier({ companyName: `Bright${BELL}` }).success, false);
  assert.equal(supplier({ companyName: ZERO_WIDTH }).success, false);
  assert.equal(supplier({ notes: `bad${ESC}[31m` }).success, false);
  assert.equal(supplier({ contactPerson: "Line\nbreak" }).success, false, "single-line fields reject line breaks");
  assert.match(messages(supplier({ companyName: `X${NUL}` })).join(" "), /Company name contains invisible control characters/);

  const item = (name: string) => inventoryCreateSchema.safeParse({
    name, category: "Products", supplierId: null, unit: "pc", sku: "SKU-01/A", imageUrl: null,
    minimumStock: 1, maximumStock: null, unitCost: 10, status: "active",
  });
  assert.equal(item(`Pomade 100g "Strong" 50% off`).success, true);
  assert.equal(item(`Pomade${NUL}`).success, false);

  assert.equal(bookingCreateSchema.safeParse({ serviceId: "cut", date: "2026-11-10", time: "10:00", notes: "Fade #2, ~1\" on top & beard trim" }).success, true);
  assert.equal(financialActionSchema.safeParse({ action: "void", reason: ZERO_WIDTH, amount: 1 }).success, false);
  assert.equal(unavailabilitySchema.safeParse({ startsAt: "2026-11-10T09:00:00+08:00", endsAt: "2026-11-10T10:00:00+08:00", reason: "Doctor's appointment (dental)" }).success, true);
});

test("search text is matched literally, so wildcard and quote characters are allowed", () => {
  for (const search of ["50%", "a_b", "O'Neil", "TXN-0001", `"quoted"`]) {
    assert.equal(transactionHistorySchema.safeParse({ search }).success, true, search);
  }
  assert.equal(transactionHistorySchema.safeParse({ search: "x".repeat(101) }).success, false);
});

test("branch codes and service names give clear, specific messages", () => {
  assert.equal(branchSchema.parse({ name: "Quezon City", code: "qc-2" }).code, "QC-2");
  assert.match(messages(branchSchema.safeParse({ name: "Quezon City", code: "QC 2" })).join(" "), /Branch code can only use letters, numbers, hyphens/);
  assert.match(messages(branchSchema.safeParse({ name: "", code: "QC" })).join(" "), /Branch name is required/);

  // Service IDs come from the name, so any name with symbols or accents works.
  assert.equal(createSlug("Haircut & Beard"), "haircut-beard");
  assert.equal(createSlug("Kids' Cut (Under 12)"), "kids-cut-under-12");
  assert.equal(createSlug("  Ahit Niño  "), "ahit-nino");
  assert.match(createSlug("✂️✂️"), /^service-[a-z0-9]+$/);
  for (const name of ["Haircut & Beard", "Kids' Cut (Under 12)", "Ahit Niño", "✂️"]) {
    const parsed = serviceSchema.safeParse({ id: createSlug(name), name, description: "", price: 250, durationMinutes: 30, active: true });
    assert.equal(parsed.success, true, name);
  }
  // Generic fallbacks name the field instead of quoting a regular expression.
  assert.deepEqual(messages(serviceSchema.safeParse({ id: "cut", name: "Cut", description: "", price: 1, durationMinutes: 1.5, active: true })), ["Duration must be a whole number of minutes"]);
  assert.match(messages(serviceSchema.safeParse({ id: "cut", name: "Cut", description: "", price: "1", durationMinutes: 1, active: true })).join(" "), /^Price must be a number$/);
});
