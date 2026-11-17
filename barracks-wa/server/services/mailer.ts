// Outgoing email. With RESEND_API_KEY and EMAIL_FROM set, messages go through
// Resend's HTTP API. Without them (local development, demos) the message is
// written to the server log instead, so flows that depend on email still work.
export type MailMessage = { to: string; subject: string; text: string };
export type MailResult = { delivered: boolean };

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!mailConfigured()) {
    console.info(`[email not configured] To: ${message.to} | ${message.subject} | ${message.text}`);
    return { delivered: false };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new Error(`Email provider responded with ${response.status}`);
  return { delivered: true };
}
