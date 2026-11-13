import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { OperationsStatusService } from "./operations-status.service";

@Catch()
export class OperationsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Operations");
  constructor(private readonly adapterHost: HttpAdapterHost, private readonly operations: OperationsStatusService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const adapter = this.adapterHost.httpAdapter;
    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest<{ method?: string; route?: { path?: unknown } }>();
    const data = exception && typeof exception === "object" ? exception as Record<string, unknown> : {};
    const httpError = Number.isInteger(data.statusCode) && Number(data.statusCode) >= 400 && Number(data.statusCode) <= 599 && typeof data.message === "string";
    const status = exception instanceof HttpException ? exception.getStatus() : httpError ? Number(data.statusCode) : 500;
    let body: object;
    if (exception instanceof HttpException) {
      const value = exception.getResponse();
      body = value && typeof value === "object" ? value : { statusCode: status, message: value };
    } else if (httpError && status < 500) {
      body = { statusCode: status, message: data.expose === false ? STATUS_CODES[status] : data.message };
    } else {
      body = { statusCode: status, message: status === 500 ? "Internal server error" : STATUS_CODES[status] ?? "Server error" };
    }
    if (status >= 500) {
      this.operations.recordServerError(status);
      const requestId = randomUUID();
      const path = request.route?.path;
      const route = typeof path === "string" && /^[A-Za-z0-9_/:.*-]{1,180}$/.test(path) ? path : "unknown";
      const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(request.method ?? "") ? request.method : "unknown";
      const code = typeof data.code === "string" && /^P\d{4}$/.test(data.code) ? data.code : undefined;
      this.logger.error(JSON.stringify({ event: "http_server_error", status, method, route, requestId, code }));
      if (!adapter.isHeadersSent(response)) adapter.setHeader(response, "X-Request-Id", requestId);
    }
    if (!adapter.isHeadersSent(response)) adapter.reply(response, body, status);
    else adapter.end(response);
  }
}
