import { BadRequestException } from "@nestjs/common";

export function historyCursor(row: { startedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ startedAt: row.startedAt.toISOString(), id: row.id }), "utf8").toString("base64url");
}

export function readHistoryCursor(value: string): { startedAt: Date; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const data: unknown = JSON.parse(bytes.toString("utf8"));
    if (!data || typeof data !== "object" || Object.keys(data).sort().join(",") !== "id,startedAt" ||
      !("id" in data) || typeof data.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id) ||
      !("startedAt" in data) || typeof data.startedAt !== "string") throw new Error();
    const startedAt = new Date(data.startedAt);
    if (!Number.isFinite(startedAt.getTime()) || startedAt.toISOString() !== data.startedAt) throw new Error();
    return { startedAt, id: data.id };
  } catch { throw new BadRequestException("Некорректный курсор истории"); }
}
