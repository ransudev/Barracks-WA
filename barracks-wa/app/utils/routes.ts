import type { ViewId } from "@/app/types/domain";

export const viewPaths: Record<ViewId, string> = {
  landing: "/",
  login: "/login",
  "customer-dashboard": "/customer/dashboard",
  "customer-profile": "/customer/profile",
  "customer-booking": "/customer/book-appointment",
  "supplier-dashboard": "/supplier/dashboard",
  "staff-dashboard": "/staff/dashboard",
  queue: "/staff/queue",
  bookings: "/staff/bookings",
  payments: "/staff/payments",
  customers: "/staff/customers",
  inventory: "/staff/inventory",
  "staff-suppliers": "/staff/suppliers",
  restocks: "/staff/restocks",
  "admin-dashboard": "/admin/dashboard",
  "staff-management": "/admin/staff",
  "admin-customers": "/admin/customers",
  "admin-barbers": "/admin/barbers",
  "admin-attendance": "/admin/attendance",
  "admin-payroll": "/admin/payroll",
  "admin-suppliers": "/admin/suppliers",
  "admin-restocks": "/admin/restocks",
  "admin-reports": "/admin/reports",
  barbers: "/staff/barbers",
  "admin-inventory": "/admin/inventory",
  "admin-branches": "/admin/branches",
  "admin-services": "/admin/services",
};

const pathsToViews = new Map(
  Object.entries(viewPaths).map(([view, path]) => [path, view as ViewId]),
);
export function pathForView(view: ViewId): string {
  return viewPaths[view];
}
export function viewForPath(pathname: string): ViewId {
  return pathsToViews.get(pathname) ?? "landing";
}
export function isKnownAppPath(pathname: string): boolean {
  return pathsToViews.has(pathname);
}
