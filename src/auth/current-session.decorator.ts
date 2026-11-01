import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthenticatedRequest } from "./auth.guard";
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) throw new UnauthorizedException();
  return request.auth.sessionId;
});
