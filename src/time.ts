// IST has a fixed UTC+5:30 offset with no daylight saving, so "wall
// clock IST" can be computed by shifting a UTC timestamp and reading
// its UTC getters - no timezone database needed, unlike most zones.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Current moment, shifted so its UTC getters read as IST wall-clock fields. */
function nowShiftedToIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** Today's date in IST, as "YYYY-MM-DD". */
export function istDateString(shifted: Date = nowShiftedToIST()): string {
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Break a real UTC instant down into its IST wall-clock date/time. */
export function toISTWallClock(d: Date): { date: string; hours: number; minutes: number } {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    date: istDateString(shifted),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** Convert an IST wall-clock date + time into a real UTC epoch-ms timestamp. */
export function istWallClockToUTCms(dateStr: string, hours: number, minutes: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcMsAsIfUTC = Date.UTC(y, m - 1, d, hours, minutes, 0);
  return utcMsAsIfUTC - IST_OFFSET_MS;
}

/** Add N days to a "YYYY-MM-DD" string (plain calendar-date arithmetic). */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Format a UTC epoch-ms timestamp as IST 12-hour time, e.g. "09:10 AM". */
export function formatIST12h(utcMs: number): string {
  const { hours, minutes } = toISTWallClock(new Date(utcMs));
  const period = hours >= 12 ? "PM" : "AM";
  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${period}`;
}
