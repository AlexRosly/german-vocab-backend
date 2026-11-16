import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { isAbsolute } from "node:path";
import { MailError } from "./mail-error";

export type MailConfig = { enabled: false } | {
  enabled: true; provider: "gmail-smtp"; fromAddress: string; fromName: string;
  username: string; password: string; port: 465 | 587;
};
const invalid = () => new MailError("mail_configuration_invalid");

export function readPrivateSmtpPassword(file: string): string {
  if (!file || !isAbsolute(file)) throw invalid();
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 256 || stat.size < 16) throw invalid();
    if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) throw invalid();
    const secret = readFileSync(fd, "utf8").trim().replace(/ /g, "");
    if (!/^[A-Za-z0-9]{16}$/.test(secret)) throw invalid();
    return secret;
  } catch { throw invalid(); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function readMailConfig(env: NodeJS.ProcessEnv, readSecret = readPrivateSmtpPassword): MailConfig {
  const enabled = env.MAIL_ENABLED ?? "false";
  if (!["true", "false"].includes(enabled)) throw invalid();
  if (enabled === "false") return { enabled: false };
  if (env.MAIL_PROVIDER !== "gmail-smtp") throw invalid();
  const username = env.SMTP_USERNAME?.trim().toLowerCase() ?? "";
  const fromAddress = env.MAIL_FROM_ADDRESS?.trim().toLowerCase() ?? "";
  const fromName = env.MAIL_FROM_NAME?.trim() || "Wortkarten";
  const port = env.SMTP_PORT ?? "465";
  if (!/^[a-z0-9][a-z0-9.]{0,63}@(gmail|googlemail)\.com$/.test(username) || username !== fromAddress ||
      !["465", "587"].includes(port) || fromName.length > 80 || /[\p{Cc}]/u.test(fromName) || !env.SMTP_PASSWORD_FILE) throw invalid();
  let password: string;
  try { password = readSecret(env.SMTP_PASSWORD_FILE); } catch { throw invalid(); }
  if (!/^[A-Za-z0-9]{16}$/.test(password)) throw invalid();
  return { enabled: true, provider: "gmail-smtp", fromAddress, fromName, username, password, port: Number(port) as 465 | 587 };
}
