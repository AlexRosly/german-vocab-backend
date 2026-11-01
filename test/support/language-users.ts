import { AuthUser } from "../../src/auth/auth.service";
import { admin, userA, userB } from "./words-database";

export function makeLanguageUsers() {
  const users = new Map<string, AuthUser & { timeZone: string; dailyGoal: number }>([userA, userB, admin].map((user) => [user.id, { ...user, timeZone: "UTC", dailyGoal: 10 }]));
  function project(user: (AuthUser & { timeZone: string; dailyGoal: number }) | undefined, select: Record<string, boolean>) {
    return user ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, user[key as keyof typeof user]])) : null;
  }
  const model = {
    findUnique: jest.fn(async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => project(users.get(where.id), select)),
    update: jest.fn(async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select: Record<string, boolean> }) => {
      const user = users.get(where.id);
      if (!user) throw new Error("Missing user");
      Object.assign(user, data);
      return project(user, select);
    }),
  };
  return { users, model };
}
