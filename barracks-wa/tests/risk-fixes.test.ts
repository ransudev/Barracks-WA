import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp } from "@/server/auth/auth-throttle";
import { bookingHasStarted, isBookingDay } from "@/app/constants/booking";
import { findWalkInMatches } from "@/app/pages/staff/queue/AddToQueueDialog";
import { customerFrontDeskProfileSchema, customerSelfUpdateSchema } from "@/server/schemas/sprint.schema";
import { inventoryCreateSchema, inventoryMetadataSchema, MAX_INVENTORY_PHOTO_CHARS } from "@/server/schemas/sprint2.schema";
import type { ApiCustomer } from "@/app/lib/api";

const request = (headers: Record<string, string>) => new Request("http://localhost/api", { headers });

test("throttling prefers the platform-set client address over a forgeable header", () => {
  assert.equal(clientIp(request({ "x-forwarded-for": "6.6.6.6", "x-nf-client-connection-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(request({ "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "198.51.100.4, 10.0.0.1" })), "198.51.100.4");
  assert.equal(clientIp(request({ "x-forwarded-for": "192.0.2.1, 10.0.0.1" })), "192.0.2.1");
  assert.equal(clientIp(request({})), null);
});

test("booking day and start helpers use Manila time", () => {
  const now = new Date("2026-10-12T02:00:00Z"); // 10:00 in Manila
  assert.equal(isBookingDay("2026-10-12", now), true);
  assert.equal(isBookingDay("2026-10-13", now), false);
  assert.equal(bookingHasStarted("2026-10-12", "09:59", now), true);
  assert.equal(bookingHasStarted("2026-10-12", "10:15", now), false);
});

test("walk-in entry suggests customers with the same phone or full name", () => {
  const base = { userId: null, email: "", preferredBarberId: null, preferredBarberName: null, createdAt: "", updatedAt: "" };
  const customers: ApiCustomer[] = [
    { ...base, id: 1, firstName: "Ana", lastName: "Cruz", phone: "+639171234567" },
    { ...base, id: 2, firstName: "Ben", lastName: "Reyes", phone: "" },
  ];
  assert.deepEqual(findWalkInMatches(customers, { firstName: "", lastName: "", phone: "0917 123 4567" }).map((c) => c.id), [1]);
  assert.deepEqual(findWalkInMatches(customers, { firstName: "ben", lastName: " Reyes ", phone: "" }).map((c) => c.id), [2]);
  assert.deepEqual(findWalkInMatches(customers, { firstName: "Ben", lastName: "", phone: "0917" }), []);
});

test("Front Desk edits cannot carry an email; customer email changes accept a password", () => {
  const profile = { firstName: "Ana", lastName: "Cruz", phone: "", preferredBarberId: null };
  assert.equal(customerFrontDeskProfileSchema.safeParse(profile).success, true);
  assert.equal(customerFrontDeskProfileSchema.safeParse({ ...profile, email: "new@example.com" }).success, false);
  assert.equal(customerSelfUpdateSchema.safeParse({ ...profile, email: "ana@example.com", currentPassword: "secret123" }).success, true);
});

test("new inventory photos are capped while unchanged older photos can be resent", () => {
  const item = { name: "Pomade", category: "Products", supplierId: null, unit: "jar", sku: null, minimumStock: 1, maximumStock: null, unitCost: 100, status: "active" };
  const large = `data:image/webp;base64,${"A".repeat(MAX_INVENTORY_PHOTO_CHARS)}`;
  assert.equal(inventoryCreateSchema.safeParse({ ...item, imageUrl: large }).success, false);
  assert.equal(inventoryMetadataSchema.safeParse({ ...item, imageUrl: large }).success, true);
  assert.equal(inventoryCreateSchema.safeParse({ ...item, imageUrl: `https://example.com/${"a".repeat(2100)}` }).success, false);
});
