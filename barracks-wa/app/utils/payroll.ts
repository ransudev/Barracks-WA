export function payrollMoney(centavos: string) {
  const amount = BigInt(centavos);
  const absolute = amount < BigInt(0) ? -amount : amount;
  return `${amount < BigInt(0) ? "−" : ""}₱${(absolute / BigInt(100)).toLocaleString("en-PH")}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export const lastDay = (end: string) =>
  new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
export const statusLabel = (status: string) => status.replaceAll("_", " ");
