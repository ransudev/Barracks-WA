export type ApiRole = "administrator" | "manager" | "front_desk" | "customer" | "supplier";

export type ApiUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: ApiRole;
  isVerified: boolean;
  isBlocked: boolean;
  isActive: boolean;
  branchIds?: number[];
  canManageAccount?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApiBarber = {
  id: number;
  branchId: number;
  firstName: string;
  lastName: string;
  status: "available" | "busy" | "unavailable";
  operationalAvailability?: ApiOperationalAvailability;
  commissionRate: number | null;
  earnedCommissionCentavos?: string;
  servicesDone: number;
  revenue: number;
  rating: number | null;
  scheduleDayCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiOperationalAvailability = {
  available: boolean;
  reason:
    | "absent"
    | "clocked_out"
    | "barber_not_found"
    | "invalid_branch"
    | "duration_unknown"
    | "reservation_collision"
    | "unavailable"
    | "serving_customer"
    | "off_shift"
    | "break"
    | "temporary_unavailability"
    | null;
  activeQueueEntryId: number | null;
  interval?: { startsAt: string; endsAt: string };
  attendanceState?: "unmarked" | "present" | "late" | "absent" | "clocked_out";
};
export type ApiBarberAvailability = Pick<
  ApiBarber,
  "id" | "firstName" | "lastName" | "status" | "operationalAvailability"
>;

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

export type ApiInventoryItem = {
  id: number;
  name: string;
  category: "Supplies" | "Equipment" | "Products";
  quantity: number;
  minimumStock: number;
  maximumStock: number | null;
  unitCost: number;
  unit: string;
  sku: string | null;
  status: "active" | "inactive";
  supplierId: number | null;
  supplierName: string | null;
  branch: string;
  branchId: number;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiLowStockAlert = {
  id: number;
  itemId: number;
  itemName: string;
  branch: string;
  currentQuantity: number;
  threshold: number;
  unit: string;
};

export type ApiSupplier = {
  id: number;
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: "active" | "inactive";
  hasAccount: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApiCustomer = {
  id: number;
  userId: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredBarberId: number | null;
  preferredBarberName: string | null;
  loyaltyPoints: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiBookingStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type ApiBooking = {
  branchId: number;
  branchName: string;
  id: number;
  date: string;
  time: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  barberId: number;
  barberName: string;
  serviceId: string;
  serviceName: string;
  price: number;
  durationMinutes: number | null;
  endTime: string | null;
  notes: string | null;
  status: ApiBookingStatus;
  createdAt: string;
  updatedAt: string;
};

export type ApiQueueEntry = {
  id: number;
  bookingId: number | null;
  visitType: "walk_in" | "appointment";
  scheduledDate: string | null;
  scheduledTime: string | null;
  bookingStatus: ApiBookingStatus | null;
  customerId: number;
  customerName: string;
  serviceId: string;
  serviceName: string;
  barberId: number | null;
  barberName: string | null;
  status: "waiting" | "ready" | "in_progress" | "completed" | "removed";
  joinedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiErrorBody = {
  success: false;
  message?: string;
  errors?: Record<string, string[]>;
};

type ApiRequestInit = RequestInit & { reuseForMs?: number };
const pendingReads = new Map<string, Promise<Response>>();
const referenceReads = new Map<string, { expiresAt: number; response: Response }>();
let cacheVersion = 0;

export function clearApiCache() {
  cacheVersion++;
  pendingReads.clear();
  referenceReads.clear();
  clearStaleReads();
}

// Last successful JSON body per GET path, for stale-while-revalidate screens: a page
// can paint what it showed last time immediately, then replace it with the fresh read.
// Never used for authorization; cleared whenever the signed-in account changes.
const lastReads = new Map<string, unknown>();
const LAST_READS_LIMIT = 60;
let staleReadVersion = 0;

export function peekApiBody<T>(path: string): T | null {
  return (lastReads.get(path) as T | undefined) ?? null;
}

function clearStaleReads() {
  staleReadVersion++;
  lastReads.clear();
}

function rememberRead(path: string, response: Response, version: number, staleVersion: number) {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return;
  void response
    .json()
    .then((body: unknown) => {
      // A request or its body can finish after a mutation or account change.
      if (version !== cacheVersion || staleVersion !== staleReadVersion) return;
      if (!body || typeof body !== "object" || (body as { success?: unknown }).success === false)
        return;
      lastReads.delete(path);
      lastReads.set(path, body);
      if (lastReads.size > LAST_READS_LIMIT) lastReads.delete(lastReads.keys().next().value!);
    })
    .catch(() => undefined);
}

export async function apiRequest(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { reuseForMs = 0, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const isRead = (requestInit.method ?? "GET").toUpperCase() === "GET";
  const canShare =
    typeof window !== "undefined" && isRead && !requestInit.signal && !requestInit.body;
  // Only explicitly opted-in reference lists may survive a completed request.
  // Operational data (queue, bookings, payments, stock) always remains fresh.
  const lifetime =
    canShare && ["/api/services", "/api/customers"].includes(path.split("?")[0])
      ? Math.min(Math.max(reuseForMs, 0), 15_000)
      : 0;
  const key = JSON.stringify([
    path,
    requestInit.cache,
    requestInit.credentials,
    Array.from(headers.entries()),
  ]);
  const cached = lifetime ? referenceReads.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.response.clone();
  if (cached) referenceReads.delete(key);
  const pending = canShare ? pendingReads.get(key) : undefined;
  if (pending) return (await pending).clone();

  if (!isRead) clearApiCache();
  const version = cacheVersion;
  const staleVersion = staleReadVersion;
  const request = fetch(path, { ...requestInit, credentials: "same-origin", headers }).then(
    (response) => {
      const current = version === cacheVersion;
      if (!isRead || (current && (response.status === 401 || response.status === 403)))
        clearApiCache();
      if (
        isRead &&
        current &&
        response.ok &&
        typeof window !== "undefined" &&
        path.startsWith("/api/") &&
        !path.startsWith("/api/auth/")
      )
        rememberRead(path, response.clone(), version, staleVersion);
      if (
        current &&
        typeof window !== "undefined" &&
        response.status === 401 &&
        !path.startsWith("/api/auth/")
      ) {
        window.dispatchEvent(new Event("barracks:session-expired"));
      }
      if (response.ok && lifetime && version === cacheVersion) {
        for (const [cachedKey, entry] of referenceReads) {
          if (entry.expiresAt <= Date.now()) referenceReads.delete(cachedKey);
        }
        if (referenceReads.size >= 16) referenceReads.delete(referenceReads.keys().next().value!);
        referenceReads.set(key, { expiresAt: Date.now() + lifetime, response: response.clone() });
      }
      return response;
    },
  );
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
