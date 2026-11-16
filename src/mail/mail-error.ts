export type MailErrorCode = "mail_disabled" | "mail_configuration_invalid" | "mail_message_invalid" |
  "mail_authentication_failed" | "mail_connection_failed" | "mail_delivery_failed";

// Do not retain the original SMTP exception: it may contain credentials or message contents.
export class MailError extends Error {
  constructor(readonly code: MailErrorCode) { super(code); this.name = "MailError"; }
}

export function safeMailFailure(error: unknown): MailError {
  if (error instanceof MailError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "EAUTH") return new MailError("mail_authentication_failed");
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ETLS"].includes(String(code))) return new MailError("mail_connection_failed");
  return new MailError("mail_delivery_failed");
}
