import { emailFieldError, phoneFieldError } from "@/app/utils/contact-validation";
import type { FormEvent } from "react";
import type { ApiBarber } from "@/app/lib/api";
import { Button, SelectField, TextField } from "@/app/components/ui";

export type CustomerFormValue = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  preferredBarberId: string;
};

export const emptyCustomerForm: CustomerFormValue = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  preferredBarberId: "",
};

export function CustomerForm({
  value,
  barbers,
  editing = false,
  submitting = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: CustomerFormValue;
  barbers: ApiBarber[];
  editing?: boolean;
  submitting?: boolean;
  onChange: (value: CustomerFormValue) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form className="modal-form" onSubmit={onSubmit}>
      <div className="form-grid form-grid--two">
        <TextField
          label="First name"
          value={value.firstName}
          required
          onChange={(event) => onChange({ ...value, firstName: event.target.value })}
        />
        <TextField
          label="Last name"
          value={value.lastName}
          required
          onChange={(event) => onChange({ ...value, lastName: event.target.value })}
        />
      </div>
      <TextField
        label="Email address"
        type="email"
        value={value.email}
        error={emailFieldError(value.email)}
        required
        onChange={(event) => onChange({ ...value, email: event.target.value })}
        icon="mail"
      />
      <TextField
        label="Phone number"
        type="tel"
        inputMode="numeric"
        maxLength={11}
        value={value.phone}
        error={phoneFieldError(value.phone)}
        onChange={(event) => onChange({ ...value, phone: event.target.value })}
        icon="phone"
      />
      {!editing && (
        <TextField
          label="Temporary password"
          type="password"
          value={value.password}
          required
          minLength={8}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
          placeholder="At least 8 characters"
          icon="lock"
        />
      )}
      <SelectField
        label="Preferred barber"
        value={value.preferredBarberId}
        onChange={(event) => onChange({ ...value, preferredBarberId: event.target.value })}
      >
        <option value="">Not set</option>
        {barbers.map((barber) => (
          <option key={barber.id} value={barber.id}>
            {barber.firstName} {barber.lastName}
          </option>
        ))}
      </SelectField>
      <div className="modal-actions">
        <Button variant="secondary" type="button" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          icon="check"
          disabled={
            submitting || Boolean(emailFieldError(value.email) || phoneFieldError(value.phone))
          }
        >
          {submitting ? "Saving…" : editing ? "Save changes" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
