"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, Modal, SelectField, TextField } from "@/app/components/ui";
import {
  apiRequest,
  errorMessage,
  readApiBody,
  type ApiBarberAvailability,
  type ApiCustomer,
  type ApiQueueEntry,
} from "@/app/lib/api";
import type { Service } from "@/app/types/domain";
import { phoneFieldError } from "@/app/utils/contact-validation";

export function AddToQueueDialog({
  branchId,
  customers,
  services,
  availableBarbers,
  onToast,
  onClose,
  onAdded,
}: {
  branchId: number;
  customers: ApiCustomer[];
  services: Service[];
  availableBarbers: ApiBarberAvailability[];
  onToast: (message: string) => void;
  onClose: () => void;
  onAdded: (entry: ApiQueueEntry, createdCustomer: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    customerId: customers[0] ? String(customers[0].id) : "new",
    serviceId: services.find((service) => service.active)?.id ?? "",
    barberId: "",
  });
  const [newCustomer, setNewCustomer] = useState({ firstName: "", lastName: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const submissionKey = useRef<string | null>(globalThis.crypto.randomUUID());
  const addInFlight = useRef(false);

  function close() {
    if (addInFlight.current) return;
    submissionKey.current = null;
    onClose();
  }

  async function addWalkIn(event: FormEvent) {
    event.preventDefault();
    if (addInFlight.current || !draft.customerId || !draft.serviceId) return;
    addInFlight.current = true;
    const idempotencyKey = submissionKey.current ?? globalThis.crypto.randomUUID();
    submissionKey.current = idempotencyKey;
    setBusy(true);
    try {
      const payload = {
        ...(draft.customerId === "new"
          ? {
              customer: {
                firstName: newCustomer.firstName,
                lastName: newCustomer.lastName,
                phone: newCustomer.phone,
              },
            }
          : { customerId: Number(draft.customerId) }),
        serviceId: draft.serviceId,
        barberId: draft.barberId ? Number(draft.barberId) : null,
        idempotencyKey,
      };
      const response = await apiRequest(`/api/queue?branchId=${branchId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await readApiBody<{ success: boolean; entry?: ApiQueueEntry; message?: string }>(
        response,
      );
      if (!response.ok || !body?.success || !body.entry)
        throw new Error(body?.message ?? "Unable to add walk-in");
      submissionKey.current = null;
      onAdded(body.entry, draft.customerId === "new");
    } catch (cause) {
      onToast(errorMessage(cause, "Unable to add walk-in"));
    } finally {
      addInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Add to queue"
      description="Choose an existing customer or add a walk-in record."
      onClose={close}
    >
      <form className="modal-form" onSubmit={addWalkIn}>
        <SelectField
          label="Customer"
          required
          disabled={busy}
          value={draft.customerId}
          onChange={(event) => {
            submissionKey.current = globalThis.crypto.randomUUID();
            setDraft({ ...draft, customerId: event.target.value });
          }}
        >
          <option value="">Select customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.firstName} {customer.lastName}
            </option>
          ))}
          <option value="new">New Walk-In Customer</option>
        </SelectField>
        {draft.customerId === "new" && (
          <>
            <TextField
              label="First name"
              required
              disabled={busy}
              autoComplete="given-name"
              value={newCustomer.firstName}
              onChange={(event) => {
                submissionKey.current = globalThis.crypto.randomUUID();
                setNewCustomer((current) => ({ ...current, firstName: event.target.value }));
              }}
            />
            <TextField
              label="Last name"
              required
              disabled={busy}
              autoComplete="family-name"
              value={newCustomer.lastName}
              onChange={(event) => {
                submissionKey.current = globalThis.crypto.randomUUID();
                setNewCustomer((current) => ({ ...current, lastName: event.target.value }));
              }}
            />
            <TextField
              label="Phone number (optional)"
              type="tel"
              inputMode="tel"
              maxLength={11}
              disabled={busy}
              value={newCustomer.phone}
              error={phoneFieldError(newCustomer.phone)}
              onChange={(event) => {
                submissionKey.current = globalThis.crypto.randomUUID();
                setNewCustomer((current) => ({ ...current, phone: event.target.value }));
              }}
            />
          </>
        )}
        <SelectField
          label="Service"
          required
          disabled={busy}
          value={draft.serviceId}
          onChange={(event) => {
            submissionKey.current = globalThis.crypto.randomUUID();
            setDraft({ ...draft, serviceId: event.target.value });
          }}
        >
          {services
            .filter((service) => service.active)
            .map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.durationMinutes} min
              </option>
            ))}
        </SelectField>
        <SelectField
          label="Barber (optional)"
          disabled={busy}
          value={draft.barberId}
          onChange={(event) => {
            submissionKey.current = globalThis.crypto.randomUUID();
            setDraft({ ...draft, barberId: event.target.value });
          }}
        >
          <option value="">Unassigned</option>
          {availableBarbers.map((barber) => (
            <option key={barber.id} value={barber.id}>
              {barber.firstName} {barber.lastName}
            </option>
          ))}
        </SelectField>
        <div className="modal-actions">
          <Button variant="secondary" type="button" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add to queue"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
