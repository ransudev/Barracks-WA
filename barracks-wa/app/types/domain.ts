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

export type Barber = {
  id: string;
  name: string;
  initials: string;
  status: "On floor" | "On break" | "Off today";
  tone: Tone;
  services: number;
  revenue: number;
  commission: number;
  rating: number;
  customers: number;
  memberSince: string;
};

export type Customer = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  email: string;
  visits: number;
  points: number;
  preferredBarber: string;
  lastVisit: string;
  tone: Tone;
};

export type Booking = {
  id: string;
  time: string;
  meridiem: string;
  customer: string;
  initials: string;
  service: string;
  barber: string;
  price: number;
  status: "Completed" | "Upcoming" | "Cancelled";
  tone: Tone;
};

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

export type Transaction = {
  id: string;
  date: string;
  customer: string;
  service: string;
  barber: string;
  method: string;
  amount: number;
  status: string;
};

export type NavigationItem = {
  id: ViewId;
  label: string;
  icon: string;
};
