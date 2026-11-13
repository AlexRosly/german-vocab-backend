import { OperationsStatusService } from "./operations/operations-status.service";
import { Controller, Get, Header } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly operations: OperationsStatusService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Проверка доступности API" })
  check() {
    return { status: "ok", service: "german-vocab-backend", monitoring: "v1", instanceId: this.operations.snapshot().instanceId };
  }
}
