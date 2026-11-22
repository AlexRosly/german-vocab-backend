import { statisticsDates } from "../src/study/study-statistics.service";

describe("Activity calendar dates", () => {
  it("keeps both sides of local midnight and includes inactive calendar dates", () => {
    expect(statisticsDates("Europe/Berlin", new Date("2026-11-20T22:59:59Z"), new Date("2026-11-20T23:00:00Z")))
      .toEqual(["2026-11-20", "2026-11-21"]);
  });
  it("uses calendar arithmetic across the spring DST jump, not fixed 24-hour midnights", () => {
    const to = new Date("2026-03-29T22:30:00Z"), from = new Date(to.getTime() - 7 * 86400000);
    expect(statisticsDates("Europe/Berlin", from, to)).toEqual([
      "2026-03-22", "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30",
    ]);
  });
  it("does not duplicate the autumn date and supports fractional offsets", () => {
    expect(statisticsDates("Europe/Berlin", new Date("2026-10-25T00:30:00Z"), new Date("2026-10-25T01:30:00Z"))).toEqual(["2026-10-25"]);
    expect(statisticsDates("Asia/Kathmandu", new Date("2026-11-01T18:14:59Z"), new Date("2026-11-01T18:15:00Z"))).toEqual(["2026-11-01", "2026-11-02"]);
  });
  it("handles leap day, negative offsets and the international date line", () => {
    expect(statisticsDates("UTC", new Date("2024-02-28T12:00Z"), new Date("2024-03-01T12:00Z"))).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(statisticsDates("America/Los_Angeles", new Date("2026-11-01T00:00Z"), new Date("2026-11-01T01:00Z"))).toEqual(["2026-10-31"]);
    expect(statisticsDates("Pacific/Kiritimati", new Date("2026-11-01T10:00Z"), new Date("2026-11-01T11:00Z"))).toEqual(["2026-11-02"]);
  });
});
