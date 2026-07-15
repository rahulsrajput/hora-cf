# Hora Alert (Cloudflare Workers version)

Scrapes vedicpanchanga.com once a day (with one retry), computes every
watched-planet Hora occurrence for the day, and schedules a Durable
Object Alarm for each heads-up/go-time message - no polling loop.

## 1. Install

```
npm install
```

## 2. Log in to Cloudflare

```
npx wrangler login
```

## 3. Set secrets (never committed to git)

```
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put MANUAL_TRIGGER_KEY
```

Each command prompts you to paste the value - it's encrypted on
Cloudflare's side and won't show up again in the dashboard or in
`wrangler.toml`. `MANUAL_TRIGGER_KEY` can be any string you make up;
it's just a shared secret so only you can hit the manual `/run` test
endpoint.

Non-secret config (`HORA_CITY_SEARCH`, `HORA_CITY_EXACT`,
`CHANNEL_URL`) already lives in `wrangler.toml` under `[vars]` - edit
that file directly if you need to change city or channel.

## 4. Deploy

```
npx wrangler deploy
```

This registers the Worker, the Cron Triggers (7:30 AM + 7:45 AM IST),
the Browser Rendering binding, and the `AlertAlarm` Durable Object.

## 5. Test without waiting for the schedule

```
curl "https://hora-alert.<your-subdomain>.workers.dev/run?key=<MANUAL_TRIGGER_KEY>"
```

## 6. Watch logs live

```
npm run tail
```

## Notes / things that will likely need adjusting on first real run

- The scraping selectors (`data-testid="panchang-city-input"` etc.)
  are copied from the site's current markup - if the site changes its
  DOM, these will need updating, same as the Python version.
- Browser Rendering free tier is 10 minutes of browser time/day, 3
  concurrent browsers - two runs/day of a single scrape should sit
  comfortably inside that.
- If a Cron Trigger's scrape fails entirely (site down, CAPTCHA), the
  Worker catches the error and sends a Telegram failure alert, same
  as the old script's `send_failure_alert()`.
- Each `AlertAlarm` Durable Object instance is used exactly once and
  deletes its own storage after firing - no separate "state.json" /
  sent-ids tracking needed, since an Alarm firing is inherently a
  one-time event.
