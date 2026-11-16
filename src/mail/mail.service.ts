import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { readMailConfig } from "./mail-config";
import { GmailSmtpTransport, MailMessage, MailTransport } from "./mail-transport";
import { MailError } from "./mail-error";

export const MAIL_GATEWAY = Symbol("WORTKARTEN_MAIL_GATEWAY");
export type MailGateway = { transport: MailTransport | null; fromAddress: string | null };

export function createMailGateway(env: NodeJS.ProcessEnv = process.env): MailGateway {
  const config = readMailConfig(env);
  return config.enabled ? { transport: new GmailSmtpTransport(config), fromAddress: config.fromAddress } : { transport: null, fromAddress: null };
}

@Injectable()
export class MailService implements OnModuleDestroy {
  constructor(@Inject(MAIL_GATEWAY) private readonly gateway: MailGateway) {}
  get enabled(): boolean { return this.gateway.transport !== null; }
  private transport(): MailTransport {
    if (!this.gateway.transport) throw new MailError("mail_disabled");
    return this.gateway.transport;
  }
  verify(): Promise<void> { return this.transport().verify(); }
  send(message: MailMessage): Promise<void> { return this.transport().send(message); }
  async sendSelfTest(): Promise<void> {
    if (!this.gateway.fromAddress) throw new MailError("mail_disabled");
    await this.send({ to: this.gateway.fromAddress, subject: "Wortkarten — проверка почты",
      text: "Это тестовое письмо Wortkarten, отправленное с вашего VPS через Gmail SMTP.\n\nПолучение письма подтверждает работу отправки в этот ящик. Письмо не содержит ссылки восстановления пароля и не меняет аккаунт." });
  }
  onModuleDestroy(): void { this.gateway.transport?.close(); }
}
