export function payrollMoney(centavos: string) {
  const amount = BigInt(centavos);
  const absolute = amount < BigInt(0) ? -amount : amount;
  return `${amount < BigInt(0) ? "−" : ""}₱${(absolute / BigInt(100)).toLocaleString("en-PH")}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
