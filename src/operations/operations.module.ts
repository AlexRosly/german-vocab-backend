import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { OperationsExceptionFilter } from "./operations-exception.filter";
import { OperationsStatusService } from "./operations-status.service";

@Module({
  providers: [OperationsStatusService, { provide: APP_FILTER, useClass: OperationsExceptionFilter }],
  exports: [OperationsStatusService],
})
export class OperationsModule {}
