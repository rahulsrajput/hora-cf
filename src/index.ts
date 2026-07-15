import puppeteer from "@cloudflare/puppeteer";
import { scrapeHoraRows, buildAlerts } from "./scraper";
import { istDateString } from "./time";
import { sendTelegram } from "./telegram";
import { AlertAlarm, Env } from "./alarmObject";

export { AlertAlarm };

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScrapeWithFailureAlert(env));
  },

  // Manual trigger for testing, e.g.:
  //   curl "https://<your-worker>.workers.dev/run?key=<MANUAL_TRIGGER_KEY>"
  // Lets you force a scrape without waiting for the Cron Trigger.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/run" && url.searchParams.get("key") === env.MANUAL_TRIGGER_KEY) {
      await runScrapeWithFailureAlert(env);
      return new Response("scrape triggered");
    }
    return new Response("not found", { status: 404 });
  },
};

async function runScrapeWithFailureAlert(env: Env): Promise<void> {
  try {
    await runScrape(env);
  } catch (err: any) {
    console.error(`FATAL: ${err?.message ?? err}`);
    // Best-effort - don't let a broken failure alert mask the real error.
    try {
      await sendTelegram(
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_CHAT_ID,
        "Hora Alert script FAILED",
        `A scrape run hit a problem and could not complete: ${err?.message ?? err}`
      );
    } catch {
      // ignore
    }
  }
}

async function runScrape(env: Env): Promise<void> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    const today = istDateString();
    const rows = await scrapeHoraRows(page, env.HORA_CITY_SEARCH, env.HORA_CITY_EXACT, today);
    const alerts = buildAlerts(rows, today);

    for (const alert of alerts) {
      const id = env.ALERT_ALARM.idFromName(alert.id);
      const stub = env.ALERT_ALARM.get(id);
      await stub.fetch("https://alarm/init", {
        method: "POST",
        body: JSON.stringify({
          planet: alert.planet,
          kind: alert.kind,
          horaStart: alert.horaStart,
          horaEnd: alert.horaEnd,
          when: alert.when,
        }),
      });
    }

    console.log(`Scheduled ${alerts.length} alert(s) for ${today}.`);
  } finally {
    await browser.close();
  }
}
