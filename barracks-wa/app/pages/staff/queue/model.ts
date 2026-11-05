import type { ApiQueueEntry } from "@/app/lib/api";

export const statusLabel = (status: ApiQueueEntry["status"]) =>
  ({
    waiting: "Waiting",
    ready: "Ready",
    in_progress: "In progress",
    completed: "Completed",
    removed: "Removed",
  })[status];
export const waitMinutes = (entry: ApiQueueEntry) =>
  Math.max(0, Math.floor((Date.now() - new Date(entry.joinedAt).getTime()) / 60_000));
export const manilaTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const visitLabel = (entry: ApiQueueEntry) =>
  entry.visitType === "appointment" ? "Appointment" : "Walk-in";
export const scheduledTime = (entry: ApiQueueEntry) => {
  if (!entry.scheduledTime) return null;
  const [hours, minutes] = entry.scheduledTime.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
};

export const tone = (status: ApiQueueEntry["status"]) =>
  status === "ready" || status === "completed"
    ? "success"
    : status === "in_progress"
      ? "info"
      : "neutral";

export const matchesSearch = (entry: ApiQueueEntry, search: string) =>
  `${entry.customerName} ${entry.serviceName} ${entry.barberName ?? ""}`
    .toLowerCase()
    .includes(search.trim().toLowerCase());
