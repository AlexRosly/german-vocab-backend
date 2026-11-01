import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class AuthOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === "GET") return true;

    const origin = request.headers.origin;
    const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
    // Browsers send Origin on fetch POST. Non-browser clients may omit it.
    if (
      (origin !== undefined && origin !== allowedOrigin) ||
      (origin === undefined && request.headers["sec-fetch-site"] === "cross-site")
    ) {
      throw new ForbiddenException("Недопустимый источник запроса");
    }
    return true;
  }
}
