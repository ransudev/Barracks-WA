import type { ApiCustomer } from "@/app/lib/api";

// /api/customers already excludes deleted accounts and non-customer roles.
// Its accountless profiles remain available for the directory and Queue only.
export function isAppointmentCustomer(customer: ApiCustomer): boolean {
  return customer.userId !== null && Number.isSafeInteger(customer.userId) && customer.userId > 0;
}

export function hasAppointmentCustomer(customers: ApiCustomer[], customerId: string): boolean {
  return customers.some(
    (customer) => String(customer.id) === customerId && isAppointmentCustomer(customer),
  );
}
