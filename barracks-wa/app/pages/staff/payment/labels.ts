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
