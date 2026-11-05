import type { RevenueReport } from "@/server/services/revenue-report.service";

export type ManagementDashboardData = {
  sales?: RevenueReport | null;
  salesError?: string;
  scope?: string;
  generatedAt?: string;
  actionableRestocks?: {
    id: number;
    supplierName: string;
    branch: string;
    branchId: number;
    status: string;
  }[];
  inventoryValue: number;
  openRestocks: number;
  todayBookings: number;
  upcomingBookings: number;
  pendingBookings: number;
  activeBarbers: number;
  customerCount: number;
  lowStock: {
    id: number;
    name: string;
    branch?: string;
    branchId: number;
    supplierName: string | null;
    category: string;
    quantity: number;
    minimumStock: number;
    unit: string;
  }[];
  recentDeliveries: {
    id: number;
    supplier_name: string;
    reference: string | null;
    received_at: string | null;
  }[];
};
