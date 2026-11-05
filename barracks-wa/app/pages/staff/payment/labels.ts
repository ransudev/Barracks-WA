import { formatCurrency } from "@/app/utils/format";
import type { PaymentMethod } from "@/server/schemas/payment.schema";

export const methods: { id: PaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "e_wallet", label: "E-wallet" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "other", label: "Other" },
];
export const methodLabel = (method: string) =>
  methods.find((item) => item.id === method)?.label ?? method;
export const money = (amount: number) => formatCurrency(amount);

export const manilaDate = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "full",
  });

export const statusTone = (status: string) =>
  status === "completed"
    ? "success"
    : ["refunded", "partially_refunded", "pending"].includes(status)
      ? "warning"
      : "danger";
