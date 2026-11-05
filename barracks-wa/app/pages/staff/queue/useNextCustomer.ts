import { useState } from "react";
import { apiRequest, errorMessage, readApiBody, type ApiQueueEntry } from "@/app/lib/api";

export function useNextCustomer(branchId: number, onAssigned: (entry: ApiQueueEntry) => void) {
  const [nextBarberId, setNextBarberId] = useState("");
  const [nextEntry, setNextEntry] = useState<ApiQueueEntry | null>(null);
  const [nextMessage, setNextMessage] = useState("");
  const [nextBusy, setNextBusy] = useState(false);

  // The queue changed, so any suggestion on screen may no longer be right.
  function reset() {
    setNextEntry(null);
    setNextMessage("");
  }

  function selectBarber(barberId: string) {
    setNextBarberId(barberId);
    reset();
  }

  async function suggestNext() {
    if (!nextBarberId) return;
    setNextBusy(true);
    setNextEntry(null);
    setNextMessage("");
    try {
      const response = await apiRequest(
        `/api/queue/next?barberId=${nextBarberId}&branchId=${branchId}`,
        { cache: "no-store" },
      );
      const body = await readApiBody<{
        success: boolean;
        entry?: ApiQueueEntry | null;
        message?: string;
      }>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to find next customer");
      setNextEntry(body.entry ?? null);
      if (!body.entry)
        setNextMessage(body.message ?? "No eligible customer is waiting for this barber.");
    } catch (cause) {
      setNextMessage(errorMessage(cause, "Unable to find next customer"));
    } finally {
      setNextBusy(false);
    }
  }

  async function confirmNextAssignment() {
    if (!nextEntry || !nextBarberId || nextEntry.status !== "waiting") return;
    setNextBusy(true);
    try {
      const response = await apiRequest(`/api/queue/next?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify({ barberId: Number(nextBarberId), entryId: nextEntry.id }),
      });
      const body = await readApiBody<{ success: boolean; entry?: ApiQueueEntry; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.entry)
        throw new Error(body?.message ?? "Unable to assign next customer");
      setNextEntry(body.entry);
      setNextMessage("");
      onAssigned(body.entry);
    } catch (cause) {
      setNextEntry(null);
      setNextMessage(errorMessage(cause, "Unable to assign next customer"));
    } finally {
      setNextBusy(false);
    }
  }

  return {
    nextBarberId,
    nextEntry,
    nextMessage,
    nextBusy,
    reset,
    selectBarber,
    suggestNext,
    confirmNextAssignment,
  };
}
