import type { OperationalAvailability } from "@/server/services/barber-operational-availability.service";
import type { BarberRecord } from "@/server/services/barber.service";
import type { BookingRecord } from "@/server/services/booking.service";
import type { CustomerRecord } from "@/server/services/customer.service";
import type { LowStockAlert } from "@/server/services/inventory-alert.service";
import type { InventoryRecord } from "@/server/services/inventory.service";
import type { QueueRecord } from "@/server/services/queue.service";
import type { SupplierRecord } from "@/server/services/supplier.service";
import type { PublicUser } from "@/server/services/user.service";

// Response shapes come from the services that produce them. These imports are
// type-only, so no server code reaches the browser.
export type ApiUser = PublicUser;
export type ApiRole = ApiUser["role"];
export type ApiOperationalAvailability = OperationalAvailability;
export type ApiBarber = BarberRecord & { operationalAvailability?: ApiOperationalAvailability };
export type ApiBarberAvailability = Pick<
  ApiBarber,
  "id" | "firstName" | "lastName" | "status" | "operationalAvailability"
>;
export type ApiInventoryItem = InventoryRecord;
export type ApiLowStockAlert = LowStockAlert;
export type ApiSupplier = SupplierRecord;
export type ApiCustomer = CustomerRecord;
export type ApiBooking = BookingRecord;
export type ApiBookingStatus = ApiBooking["status"];
export type ApiQueueEntry = QueueRecord;

export type ApiAttendance = {
  branchId: number;
  id: number;
  barberId: number;
  barberName: string;
  date: string;
  status: "present" | "late" | "absent";
  clockIn: string | null;
  clockOut: string | null;
  recordedBy: number;
  updatedBy: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiAttendanceCorrection = {
  id: number;
  previousValues: Pick<ApiAttendance, "status" | "clockIn" | "clockOut">;
  newValues: Pick<ApiAttendance, "status" | "clockIn" | "clockOut">;
  reason: string;
  correctedBy: number;
  correctedByName: string;
  createdAt: string;
};

export type ApiErrorBody = {
  success: false;
  message?: string;
  errors?: Record<string, string[]>;
};

// Identical GET requests in flight at the same time share one network request.
const pendingReads = new Map<string, Promise<Response>>();

// Last successful JSON body per GET path, so a screen can paint what it showed
// last time and then replace it with the fresh read. Never used for authorization.
const lastReads = new Map<string, unknown>();
const LAST_READS_LIMIT = 60;

// Advances on every mutation and account change, so a slower response from
// before that point cannot be remembered.
let cacheVersion = 0;

export function clearApiCache() {
  cacheVersion++;
  pendingReads.clear();
  lastReads.clear();
}

export function peekApiBody<T>(path: string): T | null {
  return (lastReads.get(path) as T | undefined) ?? null;
}

function rememberRead(path: string, response: Response, version: number) {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return;
  void response
    .json()
    .then((body: unknown) => {
      if (version !== cacheVersion) return;
      if (!body || typeof body !== "object" || (body as { success?: unknown }).success === false)
        return;
      lastReads.delete(path);
      lastReads.set(path, body);
      if (lastReads.size > LAST_READS_LIMIT) lastReads.delete(lastReads.keys().next().value!);
    })
    .catch(() => undefined);
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const isRead = (init.method ?? "GET").toUpperCase() === "GET";
  const inBrowser = typeof window !== "undefined";
  const canShare = inBrowser && isRead && !init.signal && !init.body;
  const key = JSON.stringify([path, init.cache, init.credentials, Array.from(headers.entries())]);
  const pending = canShare ? pendingReads.get(key) : undefined;
  if (pending) return (await pending).clone();

  if (!isRead) clearApiCache();
  const version = cacheVersion;
  const request = fetch(path, { ...init, credentials: "same-origin", headers }).then((response) => {
    const current = version === cacheVersion;
    const isAuthPath = path.startsWith("/api/auth/");
    if (!isRead || (current && (response.status === 401 || response.status === 403))) {
      clearApiCache();
    }
    if (isRead && current && response.ok && inBrowser && path.startsWith("/api/") && !isAuthPath) {
      rememberRead(path, response.clone(), version);
    }
    if (current && inBrowser && response.status === 401 && !isAuthPath) {
      window.dispatchEvent(new Event("barracks:session-expired"));
    }
    return response;
  });
  if (canShare) pendingReads.set(key, request);
  try {
    const response = await request;
    return canShare ? response.clone() : response;
  } finally {
    if (pendingReads.get(key) === request) pendingReads.delete(key);
  }
}

export async function readApiBody<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// The server's validation messages, or else its message, or else the fallback.
export function apiErrorMessage(
  body: { message?: string; errors?: Record<string, string[]> } | null,
  fallback: string,
): string {
  const validationMessage = body?.errors
    ? Object.values(body.errors).flat().filter(Boolean).join(" ")
    : "";
  return validationMessage || body?.message || fallback;
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
