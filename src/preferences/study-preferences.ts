import { BadRequestException } from "@nestjs/common";

export function canonicalTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) {
    throw new BadRequestException("Некорректный часовой пояс");
  }
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new BadRequestException("Некорректный часовой пояс"); }
}

export function validDailyGoal(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 500;
}

// Compare calendar dates directly. No fixed 24-hour offset or server timezone:
// repeated/skipped DST hours still belong to the correct local day.
export function localDayFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" });
}
export function localDay(formatter: Intl.DateTimeFormat, date: Date): string {
  const parts = formatter.formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}
