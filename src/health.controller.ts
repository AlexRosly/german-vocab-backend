import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Проверка доступности API" })
  check() {
    return { status: "ok", service: "german-vocab-backend" };
  }
}
