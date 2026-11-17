"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, TextField } from "@/app/components/ui";
import { apiRequest, errorMessage, readApiBody } from "@/app/lib/api";

type Status = { success: boolean; verified?: boolean; email?: string; message?: string };

// Asks a customer to confirm their email with the 6-digit code sent at sign-up.
export function EmailVerificationBanner({ onToast }: { onToast: (message: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest("/api/auth/verify-email", { cache: "no-store" })
      .then((response) => readApiBody<Status>(response))
      .then((body) => {
        if (active && body?.success) setStatus(body);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function send(payload: { code: string } | { resend: true }) {
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest("/api/auth/verify-email", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await readApiBody<Status>(response);
      if (!response.ok || !body?.success)
        throw new Error(body?.message ?? "Unable to verify email");
      if (body.verified) {
        setStatus((current) => (current ? { ...current, verified: true } : current));
        onToast("Email verified");
      } else {
        setCode("");
        onToast(body.message ?? "A new code was sent");
      }
    } catch (cause) {
      setError(errorMessage(cause, "Unable to verify email"));
    } finally {
      setBusy(false);
    }
  }

  if (!status || status.verified) return null;
  return (
    <form
      className="email-verification"
      aria-label="Verify your email"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (/^\d{6}$/.test(code)) void send({ code });
      }}
    >
      <div>
        <strong>Verify your email</strong>
        <span>Enter the 6-digit code we sent to {status.email}. It expires after 15 minutes.</span>
      </div>
      <TextField
        aria-label="Verification code"
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
      />
      <Button type="submit" disabled={busy || !/^\d{6}$/.test(code)}>
        Verify
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => void send({ resend: true })}
      >
        Resend code
      </Button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
