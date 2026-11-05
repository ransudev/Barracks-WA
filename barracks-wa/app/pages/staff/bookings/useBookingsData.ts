import { useEffect, useState } from "react";
import type { DayContext } from "@/app/components/bookings/DaySchedule";
import {
  apiRequest,
  errorMessage,
  peekApiBody,
  readApiBody,
  type ApiBarberAvailability,
  type ApiBooking,
  type ApiCustomer,
} from "@/app/lib/api";
import type { Service } from "@/app/types/domain";
import { isAppointmentCustomer } from "@/app/utils/booking-customers";

export function useBookingsData(branchId: number, date: string) {
  // Paint the last known data at once (if any), then refresh in the background.
  const [cached] = useState(() => ({
    bookings: peekApiBody<{ bookings?: ApiBooking[] }>(`/api/bookings?branchId=${branchId}`)
      ?.bookings,
    customers: peekApiBody<{ customers?: ApiCustomer[] }>("/api/customers")?.customers,
    barbers: peekApiBody<{ barbers?: ApiBarberAvailability[] }>(`/api/barbers?branchId=${branchId}`)
      ?.barbers,
    services: peekApiBody<{ services?: Service[] }>("/api/services")?.services,
  }));
  const hasCache = Boolean(
    cached.bookings && cached.customers && cached.barbers && cached.services,
  );
  const [items, setItems] = useState<ApiBooking[]>(cached.bookings ?? []);
  const [customers, setCustomers] = useState<ApiCustomer[]>(
    (cached.customers ?? []).filter(isAppointmentCustomer),
  );
  const [barbers, setBarbers] = useState<ApiBarberAvailability[]>(cached.barbers ?? []);
  const [services, setServices] = useState<Service[]>(cached.services ?? []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => (hasCache ? Date.now() : null));
  const [context, setContext] = useState<DayContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [bookingResponse, customerResponse, barberResponse, serviceResponse] =
          await Promise.all([
            apiRequest(`/api/bookings?branchId=${branchId}`, { cache: "no-store" }),
            apiRequest("/api/customers", { cache: "no-store" }),
            apiRequest(`/api/barbers?branchId=${branchId}`, { cache: "no-store" }),
            apiRequest("/api/services", { cache: "no-store" }),
          ]);
        const [bookings, customerData, barberData, serviceData] = await Promise.all([
          readApiBody<{ success: boolean; bookings?: ApiBooking[]; message?: string }>(
            bookingResponse,
          ),
          readApiBody<{ success: boolean; customers?: ApiCustomer[]; message?: string }>(
            customerResponse,
          ),
          readApiBody<{ success: boolean; barbers?: ApiBarberAvailability[]; message?: string }>(
            barberResponse,
          ),
          readApiBody<{ success: boolean; services?: Service[]; message?: string }>(
            serviceResponse,
          ),
        ]);
        if (
          !bookingResponse.ok ||
          !bookings?.success ||
          !customerResponse.ok ||
          !customerData?.success ||
          !barberResponse.ok ||
          !barberData?.success ||
          !serviceResponse.ok ||
          !serviceData?.success
        ) {
          throw new Error(
            bookings?.message ??
              customerData?.message ??
              barberData?.message ??
              serviceData?.message ??
              "Unable to load bookings",
          );
        }
        if (!active) return;
        setItems(bookings.bookings ?? []);
        setCustomers((customerData.customers ?? []).filter(isAppointmentCustomer));
        setBarbers(barberData.barbers ?? []);
        setServices(serviceData.services ?? []);
        setLoadError("");
        setUpdatedAt(Date.now());
      } catch (error) {
        if (active) setLoadError(errorMessage(error, "Unable to load bookings"));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [branchId, refreshVersion]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiRequest(`/api/scheduling/day?date=${date}&branchId=${branchId}`, {
          cache: "no-store",
        });
        const body = await readApiBody<DayContext & { success: boolean; message?: string }>(
          response,
        );
        if (!response.ok || !body?.success)
          throw new Error(body?.message ?? "Schedule constraints unavailable");
        if (active) {
          setContext(body);
          setContextError("");
        }
      } catch (cause) {
        if (active) {
          setContext(null);
          setContextError(errorMessage(cause, "Schedule constraints unavailable"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [branchId, date, refreshVersion]);

  return {
    items,
    setItems,
    customers,
    barbers,
    services,
    loading,
    loadError,
    updatedAt,
    context,
    contextError,
    refresh: () => setRefreshVersion((value) => value + 1),
  };
}
