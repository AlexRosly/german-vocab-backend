import { isEmail } from "class-validator";
import { createTransport, Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { MailConfig } from "./mail-config";
import { MailError, safeMailFailure } from "./mail-error";

export type MailMessage = { to: string; subject: string; text: string; html?: string };
export interface MailTransport {
  verify(): Promise<void>;
  send(message: MailMessage): Promise<void>;
  close(): void;
}
export type SmtpClient = Pick<Transporter<SMTPTransport.SentMessageInfo>, "verify" | "sendMail" | "close">;

export function validateMailMessage(message: MailMessage): void {
  if (!message || typeof message.to !== "string" || message.to !== message.to.trim() || message.to.length > 254 ||
      /[\p{Cc}<>;,]/u.test(message.to) || !isEmail(message.to) || typeof message.subject !== "string" ||
      !message.subject.trim() || message.subject.length > 200 || /[\p{Cc}]/u.test(message.subject) ||
      typeof message.text !== "string" || !message.text.trim() || message.text.length > 100_000 ||
      (message.html !== undefined && (typeof message.html !== "string" || message.html.length > 200_000))) throw new MailError("mail_message_invalid");
  // A message is built by trusted application templates, never from a public arbitrary-mail endpoint.
  const permitted = ["to", "subject", "text", "html"];
  if (Object.keys(message).some(key => !permitted.includes(key))) throw new MailError("mail_message_invalid");
}

export function gmailTransportOptions(config: Extract<MailConfig, { enabled: true }>): SMTPTransport.Options {
  return {
    host: "smtp.gmail.com", port: config.port, secure: config.port === 465, requireTLS: true,
    auth: { user: config.username, pass: config.password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: "smtp.gmail.com" },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, dnsTimeout: 10_000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
}

export class GmailSmtpTransport implements MailTransport {
  private readonly client: SmtpClient;
  constructor(private readonly config: Extract<MailConfig, { enabled: true }>, client?: SmtpClient) {
    this.client = client ?? createTransport(gmailTransportOptions(config));
  }
  async verify(): Promise<void> {
    try { if (!await this.client.verify()) throw new MailError("mail_connection_failed"); }
    catch (error) { throw safeMailFailure(error); }
  }
  async send(message: MailMessage): Promise<void> {
    validateMailMessage(message);
    try {
      const info = await this.client.sendMail({
        from: { name: this.config.fromName, address: this.config.fromAddress },
        to: message.to, subject: message.subject, text: message.text, ...(message.html === undefined ? {} : { html: message.html }),
        envelope: { from: this.config.fromAddress, to: [message.to] },
        disableFileAccess: true, disableUrlAccess: true,
      });
      const accepted = info.accepted?.some(address => address.toLowerCase() === message.to.toLowerCase());
      if (!accepted || info.rejected?.length) throw new MailError("mail_delivery_failed");
    } catch (error) { throw safeMailFailure(error); }
  }
  close(): void { this.client.close(); }
}
