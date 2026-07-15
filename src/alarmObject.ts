import { formatIST12h } from "./time";
import { sendTelegram } from "./telegram";

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  MANUAL_TRIGGER_KEY: string;
  CHANNEL_URL: string;
  HORA_CITY_SEARCH: string;
  HORA_CITY_EXACT: string;
  BROWSER: Fetcher;
  ALERT_ALARM: DurableObjectNamespace;
}

interface StoredAlert {
  planet: string;
  kind: "heads_up" | "go";
  horaStart: number;
  horaEnd: number;
}

/**
 * One-shot alarm. init() stores the alert's data and arms the alarm
 * for its exact "when" timestamp. When the runtime fires it, alarm()
 * sends the corresponding Telegram message, then wipes its own
 * storage - each instance is used exactly once and then discarded.
 */
export class AlertAlarm {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as StoredAlert & { when: number };
    await this.state.storage.put("alert", body);
    await this.state.storage.setAlarm(body.when);
    return new Response("scheduled");
  }

  async alarm(): Promise<void> {
    const alert = await this.state.storage.get<StoredAlert>("alert");
    if (!alert) return;

    const startStr = formatIST12h(alert.horaStart);
    const endStr = formatIST12h(alert.horaEnd);

    if (alert.kind === "heads_up") {
      await sendTelegram(
        this.env.TELEGRAM_BOT_TOKEN,
        this.env.TELEGRAM_CHAT_ID,
        `⏰ ${alert.planet} Hora in 30 min`,
        `${alert.planet} Hora starts at ${startStr}. Get to your PC.`
      );
    } else {
      await sendTelegram(
        this.env.TELEGRAM_BOT_TOKEN,
        this.env.TELEGRAM_CHAT_ID,
        `🚀 ${alert.planet} Hora NOW`,
        `${alert.planet} Hora is active until ${endStr}. Apply now.`,
        { text: "Open channel", url: this.env.CHANNEL_URL }
      );
    }

    // One-shot object - clean up after firing so nothing lingers.
    await this.state.storage.deleteAll();
  }
}
