import assert from "node:assert/strict";
import test from "node:test";
import { createStaffUserSchema, userLifecycleSchema, updateStaffUserSchema } from "@/server/schemas/user.schema";
import { barberSchema, barberStaffSchema, bookingCreateSchema, bookingEditSchema, bookingStatusSchema, bookingUpdateSchema, customerBookingEditSchema, customerProfileSchema, customerSelfProfileSchema, customerSignupSchema, inventoryItemSchema } from "@/server/schemas/sprint.schema";
import { serviceSchema } from "@/server/schemas/service.schema";
import { receiveRestockSchema, restockCreateSchema, supplierSchema } from "@/server/schemas/sprint2.schema";
import { canManageBooking } from "@/app/constants/roles";

test("staff account schemas are strict and validate lifecycle input", () => {
  const valid = createStaffUserSchema.safeParse({
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
    password: "password123",
    role: "front_desk",
  });
  assert.equal(valid.success, true);

  assert.equal(createStaffUserSchema.safeParse({
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
    password: "password123",
    role: "front_desk",
    isBlocked: true,
  }).success, false);
  assert.equal(updateStaffUserSchema.safeParse({
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
    role: "front_desk",
  }).success, true);
  assert.equal(userLifecycleSchema.safeParse({ action: "block", extra: true }).success, false);
  assert.equal(userLifecycleSchema.safeParse({ action: "unblock" }).success, true);
});

test("inventory and barber schemas reject unsafe values", () => {
  assert.equal(inventoryItemSchema.safeParse({
    name: "Neck strips",
    category: "Unknown",
    quantity: 1,
    minimumStock: 1,
    unitCost: 1,
  }).success, false);
  assert.equal(inventoryItemSchema.safeParse({
    name: "Neck strips",
    category: "Supplies",
    quantity: -1,
    minimumStock: 1,
    unitCost: 1,
  }).success, false);
  assert.equal(inventoryItemSchema.safeParse({
    name: "Neck strips",
    category: "Supplies",
    quantity: 1,
    minimumStock: 1,
    unitCost: 1.001,
  }).success, false);
  assert.equal(barberSchema.safeParse({
    branchId: 1,
    firstName: "Miko",
    lastName: "Reyes",
    status: "available",
    commissionRate: 101,
  }).success, false);
  assert.equal(barberSchema.safeParse({
    branchId: 1,
    firstName: "Miko",
    lastName: "Reyes",
    status: "available",
    commissionRate: 45.25,
    rating: 4.8,
  }).success, true);
  assert.equal(barberSchema.safeParse({
    branchId: 1,
    firstName: "Miko",
    lastName: "Reyes",
    status: "available",
    commissionRate: 45.25,
    rating: 5.1,
  }).success, false);
  assert.equal(barberStaffSchema.safeParse({
    branchId: 1,
    firstName: "Miko",
    lastName: "Reyes",
    status: "available",
  }).success, true);
  assert.equal(barberStaffSchema.safeParse({
    branchId: 1,
    firstName: "Miko",
    lastName: "Reyes",
    status: "available",
    commissionRate: 45.25,
  }).success, false);
  assert.equal(barberStaffSchema.safeParse({
    branchId: 1,
    firstName: "Miko",
    lastName: "Reyes",
    status: "available",
    commissionRate: 45.25,
    servicesDone: 20,
  }).success, false);
  assert.equal(customerProfileSchema.safeParse({
    firstName: "Test",
    lastName: "Customer",
    email: "customer@example.com",
    phone: "",
    preferredBarberId: null,
    loyaltyPoints: 100,
  }).success, true);
  assert.equal(customerProfileSchema.safeParse({
    firstName: "Test",
    lastName: "Customer",
    email: "customer@example.com",
    phone: "",
    preferredBarberId: null,
    loyaltyPoints: -1,
  }).success, false);
  assert.equal(customerSelfProfileSchema.safeParse({
    firstName: "Test",
    lastName: "Customer",
    email: "customer@example.com",
    phone: "",
    preferredBarberId: null,
    loyaltyPoints: 100,
  }).success, false);
  assert.equal(customerSignupSchema.safeParse({
    firstName: "Test",
    lastName: "Customer",
    email: "customer@example.com",
    password: "password123",
    phone: "09000000000",
    preferredBarberId: null,
  }).success, true);
  assert.equal(customerSignupSchema.safeParse({
    firstName: "Test",
    lastName: "Customer",
    email: "customer@example.com",
    password: "password123",
    phone: "090000000000",
    preferredBarberId: null,
  }).success, false);
  assert.equal(supplierSchema.safeParse({
    companyName: "Test Supplier",
    phone: "09000000000",
  }).success, true);
  assert.equal(supplierSchema.safeParse({
    companyName: "Test Supplier",
    phone: "090000000000",
  }).success, false);
});

test("booking permissions keep customer changes owner-scoped and limit destructive staff actions", () => {
  assert.equal(canManageBooking("customer", "edit", true), true);
  assert.equal(canManageBooking("customer", "cancel", true), true);
  assert.equal(canManageBooking("customer", "edit", false), false);
  assert.equal(canManageBooking("customer", "complete", true), false);
  assert.equal(canManageBooking("customer", "check_in", true), false);
  assert.equal(canManageBooking("customer", "start", true), false);
  assert.equal(canManageBooking("customer", "no_show", true), false);
  assert.equal(canManageBooking("customer", "delete", true), false);
  assert.equal(canManageBooking("front_desk", "edit"), true);
  assert.equal(canManageBooking("front_desk", "cancel"), true);
  assert.equal(canManageBooking("front_desk", "check_in"), true);
  assert.equal(canManageBooking("front_desk", "start"), true);
  assert.equal(canManageBooking("front_desk", "no_show"), true);
  // Staff may remove bookings; the service keeps started/completed bookings on record.
  assert.equal(canManageBooking("front_desk", "delete"), true);
  assert.equal(canManageBooking("manager", "delete"), true);
});

test("booking schemas keep status transitions terminal and edits explicit", () => {
  assert.equal(bookingStatusSchema.safeParse("confirmed").success, true);
  assert.equal(bookingStatusSchema.safeParse("checked_in").success, true);
  assert.equal(bookingStatusSchema.safeParse("in_progress").success, true);
  assert.equal(bookingStatusSchema.safeParse("no_show").success, true);
  assert.equal(bookingStatusSchema.safeParse("upcoming").success, false);
  assert.equal(bookingCreateSchema.safeParse({ barberId: 1, serviceId: "barracks-basic", date: "2099-01-02", time: "10:00", notes: "  hello  " }).data?.notes, "hello");
  assert.equal(bookingCreateSchema.safeParse({ barberId: 1, serviceId: "barracks-basic", date: "2099-01-02", time: "10:00", notes: "x".repeat(501) }).success, false);
  assert.equal(bookingUpdateSchema.safeParse({ status: "completed" }).success, true);
  assert.equal(bookingUpdateSchema.safeParse({ status: "cancelled" }).success, true);
  assert.equal(bookingUpdateSchema.safeParse({ status: "upcoming" }).success, false);
  assert.equal(bookingUpdateSchema.safeParse({ status: "completed", customerId: 1 }).success, false);
  assert.equal(bookingEditSchema.safeParse({
    customerId: 1,
    barberId: 2,
    serviceId: "barracks-basic",
    date: "2099-01-02",
    time: "10:00",
  }).success, true);
  assert.equal(bookingEditSchema.safeParse({
    customerId: 1,
    barberId: 2,
    serviceId: "barracks-basic",
    date: "2099-02-30",
    time: "10:00",
  }).success, false);
  assert.equal(customerBookingEditSchema.safeParse({
    barberId: 2,
    serviceId: "barracks-basic",
    date: "2099-01-02",
    time: "10:00",
  }).success, true);
  assert.equal(customerBookingEditSchema.safeParse({
    customerId: 99,
    barberId: 2,
    serviceId: "barracks-basic",
    date: "2099-01-02",
    time: "10:00",
  }).success, false);
});

test("service schema validates numeric duration, price, and status", () => {
  const valid = { id: "test-cut", name: "Test cut", description: "A cut", price: 250, durationMinutes: 45, active: true };
  assert.equal(serviceSchema.safeParse(valid).success, true);
  assert.equal(serviceSchema.safeParse({ ...valid, durationMinutes: 0 }).success, false);
  assert.equal(serviceSchema.safeParse({ ...valid, durationMinutes: 45.5 }).success, false);
  assert.equal(serviceSchema.safeParse({ ...valid, price: -1 }).success, false);
  assert.equal(serviceSchema.safeParse({ ...valid, price: 1.001 }).success, false);
  assert.equal(serviceSchema.safeParse({ ...valid, active: "true" }).success, false);
});

test("branch-aware inventory and restock schemas preserve safe defaults and reject duplicate lines", () => {
  const inventory = inventoryItemSchema.parse({
    name: "Neck strips",
    category: "Supplies",
    quantity: 4,
    minimumStock: 2,
    unitCost: 12.5,
  });
  assert.equal(inventory.branch, "Main Branch");
  assert.equal(restockCreateSchema.safeParse({
    supplierId: 1,
    branch: "Maa Branch",
    items: [
      { inventoryItemId: 10, requestedQuantity: 2 },
      { inventoryItemId: 10, requestedQuantity: 3 },
    ],
  }).success, false);
  assert.equal(receiveRestockSchema.safeParse({
    items: [
      { restockRequestItemId: 4, deliveredQuantity: 1 },
      { restockRequestItemId: 4, deliveredQuantity: 1 },
    ],
  }).success, false);
});
