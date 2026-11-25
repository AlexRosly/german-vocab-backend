import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedRequest } from "../auth/auth.guard";

export const auditActor = new AsyncLocalStorage<{ id: string; role: string }>();

@Injectable()
export class AuditActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user;
    if (!user) return next.handle();
    return new Observable(subscriber => auditActor.run({ id: user.id, role: user.role }, () => {
      const subscription = next.handle().subscribe(subscriber);
      return () => subscription.unsubscribe();
    }));
  }
}

// SET LOCAL is scoped to this transaction and cannot contaminate a pooled connection.
export async function setAuditActor(tx: Prisma.TransactionClient) {
  const actor = auditActor.getStore();
  if (actor) await tx.$executeRaw`SELECT set_config('wortkarten.actor_id', ${actor.id}, true), set_config('wortkarten.actor_role', ${actor.role}, true)`;
}
