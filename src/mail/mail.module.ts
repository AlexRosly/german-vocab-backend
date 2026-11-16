import { Module } from "@nestjs/common";
import { createMailGateway, MAIL_GATEWAY, MailService } from "./mail.service";

@Module({
  providers: [{ provide: MAIL_GATEWAY, useFactory: () => createMailGateway() }, MailService],
  exports: [MailService],
})
export class MailModule {}
