import { mkdtempSync, writeFileSync, chmodSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { readMailConfig, readPrivateSmtpPassword } from "../src/mail/mail-config";
import { MailError, safeMailFailure } from "../src/mail/mail-error";
import { gmailTransportOptions, GmailSmtpTransport, type SmtpClient } from "../src/mail/mail-transport";
import { createMailGateway, MAIL_GATEWAY, MailService } from "../src/mail/mail.service";
import { MailModule } from "../src/mail/mail.module";

const secret = "abcdefghijklmnop";
const env = { MAIL_ENABLED: "true", MAIL_PROVIDER: "gmail-smtp", SMTP_USERNAME: "wortkarten.test@gmail.com", MAIL_FROM_ADDRESS: "wortkarten.test@gmail.com", SMTP_PASSWORD_FILE: "/private/password", SMTP_PORT: "465" };
function config() { const c = readMailConfig(env, () => secret); if (!c.enabled) throw Error(); return c; }
const message = { to: "learner@example.com", subject: "Wortkarten", text: "Тест без реальных писем" };
function mockSmtp() { return { verify: jest.fn().mockResolvedValue(true), sendMail: jest.fn().mockResolvedValue({ accepted: [message.to], rejected: [] }), close: jest.fn() }; }

describe("Gmail mail configuration and secret boundary", () => {
  it("defaults to disabled and does not read stale SMTP credentials", () => {
    const load = jest.fn(); expect(readMailConfig({}, load)).toEqual({ enabled: false });
    expect(readMailConfig({ MAIL_ENABLED: "false", SMTP_PASSWORD_FILE: "secret" }, load)).toEqual({ enabled: false }); expect(load).not.toHaveBeenCalled();
    expect(createMailGateway({})).toEqual({ transport: null, fromAddress: null });
  });
  it("validates provider, one matching Gmail sender, port and app password without retaining errors", () => {
    expect(config()).toMatchObject({ enabled: true, fromAddress: env.MAIL_FROM_ADDRESS, password: secret, port: 465 });
    for (const patch of [{ MAIL_ENABLED: "1" }, { MAIL_PROVIDER: "resend" }, { SMTP_USERNAME: "a@example.com" }, { MAIL_FROM_ADDRESS: "other@gmail.com" }, { SMTP_PORT: "25" }, { SMTP_PASSWORD_FILE: "" }, { MAIL_FROM_NAME: "Wortkarten\r\nBcc:private@example.com" }]) {
      expect(() => readMailConfig({ ...env, ...patch }, () => secret)).toThrow("mail_configuration_invalid");
    }
    expect(() => readMailConfig(env, () => "normal-password-is-not-an-app-password")).toThrow("mail_configuration_invalid");
    try { readMailConfig(env, () => { throw Error("private token at /secret/path"); }); } catch (e) { expect(String(e)).not.toMatch(/private token|secret\/path/); }
  });
  it("reads a bounded private file and accepts Google's grouped app-password format", () => {
    const dir = mkdtempSync(join(tmpdir(), "wk-mail-")), file = join(dir, "smtp-password");
    try {
      writeFileSync(file, "abcd efgh ijkl mnop\n", { mode: 0o600 }); expect(readPrivateSmtpPassword(file)).toBe(secret);
      if (process.platform !== "win32") { chmodSync(file, 0o644); expect(() => readPrivateSmtpPassword(file)).toThrow("mail_configuration_invalid"); chmodSync(file, 0o600); }
      writeFileSync(file, "a".repeat(257)); expect(() => readPrivateSmtpPassword(file)).toThrow("mail_configuration_invalid");
      expect(() => readPrivateSmtpPassword("relative/password")).toThrow("mail_configuration_invalid");
      expect(() => readPrivateSmtpPassword(dir)).toThrow("mail_configuration_invalid");
    } finally { unlinkSync(file); rmdirSync(dir); }
  });
});

describe("Gmail SMTP transport without real network or messages", () => {
  it("enforces TLS/certificate verification, bounded timeouts and no protocol/content logging", () => {
    const c = config(), secure = gmailTransportOptions(c), starttls = gmailTransportOptions({ ...c, port: 587 });
    expect(secure).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true, requireTLS: true, debug: false, logger: false, disableFileAccess: true, disableUrlAccess: true, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true } });
    expect(starttls).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(secure.connectionTimeout).toBeLessThanOrEqual(10000); expect(secure.socketTimeout).toBeLessThanOrEqual(20000);
  });
  it("verify authenticates without sending, and a single send uses the configured envelope", async () => {
    const smtp = mockSmtp(), transport = new GmailSmtpTransport(config(), smtp as unknown as SmtpClient);
    await transport.verify(); expect(smtp.sendMail).not.toHaveBeenCalled();
    await transport.send(message); expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail.mock.calls[0][0]).toMatchObject({ ...message, from: { name: "Wortkarten", address: env.MAIL_FROM_ADDRESS }, envelope: { from: env.MAIL_FROM_ADDRESS, to: [message.to] }, disableFileAccess: true, disableUrlAccess: true });
    transport.close(); expect(smtp.close).toHaveBeenCalled();
  });
  it("rejects header injection, multiple recipients and attachments before contacting SMTP", async () => {
    const smtp = mockSmtp(), transport = new GmailSmtpTransport(config(), smtp as unknown as SmtpClient);
    for (const input of [{ ...message, to: "a@example.com,b@example.com" }, { ...message, to: "a@example.com\r\nBcc:b@example.com" }, { ...message, subject: "Test\r\nBcc:b@example.com" }, { ...message, text: "" }, { ...message, attachments: [{ path: "/etc/passwd" }] }, { ...message, from: "fake@example.com" }]) {
      await expect(transport.send(input)).rejects.toMatchObject({ code: "mail_message_invalid" });
    }
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });
  it("sanitizes SMTP exceptions and does not retry an ambiguous send", async () => {
    for (const [code, expected] of [["EAUTH", "mail_authentication_failed"], ["ETIMEDOUT", "mail_connection_failed"], ["ESMTP", "mail_delivery_failed"]]) {
      const smtp = mockSmtp(); smtp.sendMail.mockRejectedValue(Object.assign(Error("password=" + secret + " token=hidden"), { code, response: "private response" }));
      const transport = new GmailSmtpTransport(config(), smtp as unknown as SmtpClient);
      await expect(transport.send(message)).rejects.toMatchObject({ code: expected, message: expected }); expect(smtp.sendMail).toHaveBeenCalledTimes(1);
      const safe = safeMailFailure(Object.assign(Error(secret), { code })); expect(safe.stack).not.toContain(secret); expect(safe).not.toHaveProperty("cause"); expect(safe).not.toHaveProperty("response");
    }
  });
  it("does not claim acceptance for missing or rejected recipient and handles failed verification safely", async () => {
    for (const info of [{ accepted: [], rejected: [] }, { accepted: [message.to], rejected: [message.to] }, { accepted: ["other@example.com"], rejected: [] }]) {
      const smtp = mockSmtp(); smtp.sendMail.mockResolvedValue(info); await expect(new GmailSmtpTransport(config(), smtp as unknown as SmtpClient).send(message)).rejects.toMatchObject({ code: "mail_delivery_failed" });
    }
    const smtp = mockSmtp(); smtp.verify.mockRejectedValue(Object.assign(Error(secret), { code: "EAUTH" }));
    await expect(new GmailSmtpTransport(config(), smtp as unknown as SmtpClient).verify()).rejects.toMatchObject({ code: "mail_authentication_failed" });
  });
});

describe("MailService and Nest module", () => {
  it("can be wired into Nest with a fake gateway and only self-tests to the configured sender", async () => {
    const transport = { verify: jest.fn().mockResolvedValue(undefined), send: jest.fn().mockResolvedValue(undefined), close: jest.fn() };
    const module = await Test.createTestingModule({ imports: [MailModule] }).overrideProvider(MAIL_GATEWAY).useValue({ transport, fromAddress: env.MAIL_FROM_ADDRESS }).compile();
    const service = module.get(MailService); expect(service.enabled).toBe(true); await service.verify(); expect(transport.send).not.toHaveBeenCalled(); await service.sendSelfTest();
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: env.MAIL_FROM_ADDRESS })); expect(transport.send.mock.calls[0][0].text).not.toContain(secret);
    await module.close(); expect(transport.close).toHaveBeenCalledTimes(1);
  });
  it("fails closed while disabled", () => {
    const service = new MailService({ transport: null, fromAddress: null }); expect(service.enabled).toBe(false);
    expect(() => service.verify()).toThrow(new MailError("mail_disabled")); expect(() => service.send(message)).toThrow(new MailError("mail_disabled")); service.onModuleDestroy();
  });
});
