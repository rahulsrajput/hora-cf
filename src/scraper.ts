import { addDaysToDateStr, istWallClockToUTCms, toISTWallClock } from "./time";

const MONTH_ABBR: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const WATCHED_PLANETS = new Set(["Mercury", "Jupiter", "Moon"]);
const LEAD_TIME_MIN = 30;
const DAILY_WINDOW_START_MIN = 7 * 60; // 7:00 AM
const DAILY_WINDOW_END_MIN = 23 * 60 + 59; // 23:59

interface ClockTime {
  hours: number;
  minutes: number;
}

interface RawRow {
  planet: string;
  start: ClockTime;
  end: ClockTime;
}

export interface Alert {
  id: string;
  planet: string;
  kind: "heads_up" | "go";
  when: number; // epoch ms
  horaStart: number; // epoch ms
  horaEnd: number; // epoch ms
}

function parseTimeStr(t: string): ClockTime {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Could not parse time string: ${t}`);
  let hours = parseInt(m[1], 10) % 12;
  const minutes = parseInt(m[2], 10);
  if (m[3].toUpperCase() === "PM") hours += 12;
  return { hours, minutes };
}

function parseHoraRange(text: string): [ClockTime, ClockTime] {
  // En dash, not hyphen, in the site's markup.
  const parts = text.trim().split(/\s*[\u2013\u2012-]\s*/);
  if (parts.length !== 2) throw new Error(`Could not split Hora time range: ${text}`);
  return [parseTimeStr(parts[0]), parseTimeStr(parts[1])];
}

/**
 * Sets the city, submits the form, and returns all 24 Hora rows in
 * chronological order (12 day rows, then 12 night rows). `page` is a
 * @cloudflare/puppeteer Page.
 */
export async function scrapeHoraRows(
  page: any,
  citySearchText: string,
  cityExactText: string,
  todayIST: string
): Promise<RawRow[]> {
  await page.goto("https://vedicpanchanga.com/", { waitUntil: "networkidle0", timeout: 45000 });

  await page.waitForSelector('[data-testid="panchang-city-input"]', { visible: true, timeout: 15000 });
  const currentValue: string = (await page.$eval('[data-testid="panchang-city-input"]', (el: any) => el.value)).trim();

  if (currentValue !== cityExactText) {
    await page.click('[data-testid="panchang-city-input"]');
    await page.$eval('[data-testid="panchang-city-input"]', (el: any) => (el.value = ""));
    await page.type('[data-testid="panchang-city-input"]', citySearchText, { delay: 80 });

    await page.waitForSelector('[data-testid="panchang-city-results"]', { visible: true, timeout: 8000 });

    const options = await page.$$('[data-testid^="panchang-city-option-"]');
    const texts: string[] = [];
    for (const opt of options) {
      texts.push(await page.evaluate((el: any) => el.textContent.trim(), opt));
    }

    let matchIndex = texts.findIndex((t) => t === cityExactText);
    if (matchIndex === -1) {
      matchIndex = texts.findIndex((t) => t.toLowerCase().includes(citySearchText.toLowerCase()));
    }
    if (matchIndex === -1) {
      throw new Error(`Could not find city option matching "${cityExactText}". Available: ${texts.join(", ")}`);
    }
    await options[matchIndex].click();

    const finalValue: string = await page.$eval('[data-testid="panchang-city-input"]', (el: any) => el.value);
    if (!finalValue.toLowerCase().includes(citySearchText.toLowerCase())) {
      throw new Error(`After selecting city, input shows "${finalValue}", which doesn't look right.`);
    }
  }

  await page.click('[data-testid="panchang-fetch-btn"]');
  await page.waitForSelector('[data-testid="hora-day-row-0"]', { visible: true, timeout: 20000 });

  // Sanity check: confirm the date shown matches today in IST before
  // trusting any of the table data.
  const dateText: string = (await page.$eval('[data-testid="panchang-date-trigger"]', (el: any) => el.textContent)).trim();
  const dm = dateText.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!dm) throw new Error(`Could not parse date shown on page: ${dateText}`);
  const shownMonth = MONTH_ABBR[dm[2]];
  if (!shownMonth) throw new Error(`Unrecognized month abbreviation in date text: ${dateText}`);
  const shownDateStr = `${dm[3]}-${String(shownMonth).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  if (shownDateStr !== todayIST) {
    throw new Error(`Page is showing date ${shownDateStr} but today in IST is ${todayIST}. Aborting.`);
  }

  const rows: RawRow[] = [];
  for (const prefix of ["hora-day-row-", "hora-night-row-"]) {
    let i = 0;
    while (true) {
      const rowEl = await page.$(`[data-testid="${prefix}${i}"]`);
      if (!rowEl) break;
      const cells = await rowEl.$$("td");
      const planet: string = (await page.evaluate((el: any) => el.textContent.trim(), cells[0]));
      const timeRange: string = (await page.evaluate((el: any) => el.textContent.trim(), cells[1]));
      const [start, end] = parseHoraRange(timeRange);
      rows.push({ planet, start, end });
      i++;
    }
  }

  if (rows.length !== 24) {
    console.warn(`Expected 24 Hora rows (12 day + 12 night), got ${rows.length}.`);
  }

  return rows;
}

/**
 * Walk the chronological rows, attach real UTC timestamps (rolling
 * the IST calendar date forward on midnight crossings), keep EVERY
 * occurrence of each watched planet inside the daily window, and
 * build a heads-up + go-time alert pair for each one.
 */
export function buildAlerts(rows: RawRow[], anchorDateStr: string): Alert[] {
  let currentDateStr = anchorDateStr;
  let prevEndMs: number | null = null;
  const dated: { planet: string; startMs: number; endMs: number }[] = [];

  for (const row of rows) {
    let startMs = istWallClockToUTCms(currentDateStr, row.start.hours, row.start.minutes);
    if (prevEndMs !== null && startMs < prevEndMs) {
      currentDateStr = addDaysToDateStr(currentDateStr, 1);
      startMs = istWallClockToUTCms(currentDateStr, row.start.hours, row.start.minutes);
    }
    let endMs = istWallClockToUTCms(currentDateStr, row.end.hours, row.end.minutes);
    if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;

    dated.push({ planet: row.planet, startMs, endMs });
    prevEndMs = endMs;
  }

  const selected = dated.filter((r) => {
    if (!WATCHED_PLANETS.has(r.planet)) return false;
    const { date, hours, minutes } = toISTWallClock(new Date(r.startMs));
    if (date !== anchorDateStr) return false;
    const minuteOfDay = hours * 60 + minutes;
    return minuteOfDay >= DAILY_WINDOW_START_MIN && minuteOfDay <= DAILY_WINDOW_END_MIN;
  });

  const alerts: Alert[] = [];
  for (const row of selected) {
    const headsUpMs = row.startMs - LEAD_TIME_MIN * 60 * 1000;
    const key = new Date(row.startMs).toISOString();
    alerts.push({
      id: `${row.planet}_${key}_heads_up`,
      planet: row.planet,
      kind: "heads_up",
      when: headsUpMs,
      horaStart: row.startMs,
      horaEnd: row.endMs,
    });
    alerts.push({
      id: `${row.planet}_${key}_go`,
      planet: row.planet,
      kind: "go",
      when: row.startMs,
      horaStart: row.startMs,
      horaEnd: row.endMs,
    });
  }

  alerts.sort((a, b) => a.when - b.when);
  return alerts;
}
