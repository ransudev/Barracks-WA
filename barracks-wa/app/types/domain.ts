export type Tone = "blue" | "green" | "amber" | "violet" | "red" | "slate";

export type ViewId =
  | "landing"
  | "login"
  | "customer-dashboard"
  | "customer-profile"
  | "customer-booking"
  | "supplier-dashboard"
  | "staff-dashboard"
  | "queue"
  | "bookings"
  | "payments"
  | "customers"
  | "inventory"
  | "staff-suppliers"
  | "restocks"
  | "admin-dashboard"
  | "staff-management"
  | "admin-customers"
  | "admin-barbers"
  | "admin-attendance"
  | "admin-payroll"
  | "admin-suppliers"
  | "admin-restocks"
  | "admin-reports"
  | "barbers"
  | "admin-inventory"
  | "admin-services"
  | "admin-branches";

export type ShellArea = "staff" | "admin";

export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number | null;
  price: number;
  active: boolean;
  hasHistory?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type NavigationItem = {
  id: ViewId;
  label: string;
  icon: string;
};
