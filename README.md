# Garmin Uzbekistan — AI sales funnel

Instagram Reels → web app → AI Telegram bot → manager.

```
Instagram Reel  ──"See More"──▶  web app (Vercel)  ──button──▶  @garminofficialuzbot  ──hot lead──▶  manager
```

A customer watching a Reel taps through to the web app, browses the catalog,
takes the quiz or compares models, then taps a Telegram button. The bot opens
already knowing which watch they were looking at, answers their questions in
Russian or Uzbek, and pings a human manager the moment the customer is ready to
buy.

## Layout

| Path | What it is | Hosted on |
| --- | --- | --- |
| `web/` | Mobile web app — catalog, quiz, comparison, battery simulator | Vercel |
| `bot/` | Telegram bot powered by DeepSeek | Render (free) |
| `render.yaml` | Render Blueprint for the bot | — |

The web app is the single source of truth for products and prices.
`bot/scripts/build-catalog.mjs` reads `web/js/data.js` and generates
`bot/src/catalog/catalog.json`, which the bot loads at boot. Re-run
`npm run build` in `bot/` after any catalog change.

## How the hand-off works

Buttons in the web app link to `https://t.me/garminofficialuzbot?start=<payload>`
where the payload is `{source}__{productId}__{lang}`:

| Payload | Meaning |
| --- | --- |
| `card__fenix-8__ru` | Tapped "Order" on the fēnix 8 product card, UI in Russian |
| `quiz__forerunner-970__uz` | Finished the quiz, it recommended Forerunner 970, UI in Uzbek |
| `cmp__venu-3__ru` | Tapped "Order" in the comparison table |
| `cta__-__ru` | Generic "Message us" button, no product |

Telegram caps the payload at 64 characters of `[A-Za-z0-9_-]`, which is why
fields are joined with `__` and "no product" is a bare `-`. Generation lives in
[web/js/telegram.js](web/js/telegram.js); parsing lives in
[bot/src/deeplink.js](bot/src/deeplink.js). The bot resolves the id against the
catalog, so a link to a discontinued model degrades to a normal greeting instead
of breaking.

## Lead capture

The AI has a `notify_manager` tool with two urgency levels:

- **`now` → 🔥 hot lead.** Customer says they want to buy today, asks how to pay,
  asks about stock, wants an invoice, or asks for a human. The manager gets a
  notification with sound, the customer's phone and `@username`, the product, and
  a direct link to the chat.
- **`next` → 🟡 warm lead.** Concrete interest but still deciding. Silent
  notification for follow-up during working hours.

`/manager` always fires a hot alert without involving the AI. The "💬 Написать
нам" button does **not** — it's a soft nudge plus direct call/Telegram links,
so a casual tap doesn't page a human on a 5-minute SLA. Sharing a phone number
via the keyboard button also creates a lead. The bot will not re-alert for the
same intent twice.

### Customers with no @username or a hidden phone number

Many customers have no public `@username` and keep their number private, so
the alert may carry no link and no phone. The manager never needs either:
**reply to the alert** (text, photo, voice — anything) and the bot delivers it
to the customer; while a manager is replying, the customer's messages are
relayed back the same way. `/release` hands the chat back to the AI.

- A buy-now lead is held until the bot has a phone **and** pickup/delivery
  choice — but if the customer taps «Позже» or says they won't share a number,
  it goes out immediately, marked so, instead of waiting out the timer.
- Phones are normalised before they are stored (invisible characters stripped,
  `+` added, 9-digit local numbers get `+998`); words, too-short numbers and
  our own store number are rejected, so the AI can't hand the manager a lead
  with an unusable phone.
- Replies are routed by the `ID: <code>…</code>` marker in messages the bot
  itself sent. A customer who names themselves "ID: 12345" cannot redirect
  the manager's replies.

Leads are appended to `bot/data/leads.jsonl` **and** sent to the manager chat.
Render's free instance has no persistent disk, so treat the Telegram alert as the
durable record until a database is wired up.

## Extended catalog (non-watch products)

Garmin sells more than watches — marine electronics, cycling computers,
fishfinders, aviation gear, dog trackers, and so on. Rather than hand-writing a
structured data entry for each one, that catalog lives as ordinary photo+caption
posts in a Telegram channel (currently `t.me/cataloggarmintest`).

**Setup**: add `@garminofficialuzbot` as an **admin** of that channel. That's
the only way Telegram delivers `channel_post` updates to a bot at all — without
it, posts are invisible to the bot and nothing gets indexed.

From then on, every photo you post with a Cyrillic caption is indexed
automatically ([bot/src/channelCatalog.js](bot/src/channelCatalog.js)). When a
customer asks about something in that range, the AI calls
`search_channel_catalog` to find the matching post, then `forward_channel_product`
to send the real photo and full description via `copyMessage` — the customer
sees your actual post, not the AI's paraphrase of it.

Like leads, the index is a JSONL file on Render's ephemeral disk — a redeploy
wipes it, and it rebuilds from whatever the bot observes going forward. Move it
to a database (e.g. the Supabase project the web app already has) if losing the
index on redeploy becomes a real problem.

## Bot commands

| Command | Effect |
| --- | --- |
| `/start` | Greeting; accepts the web app deep-link payload |
| `/lang` | Switch RU / UZ |
| `/manager` | Hot alert to a human |
| `/reset` | Clear conversation history |
| `/help` | Command list |
| `/stats` | Lead counters — only responds in the manager chat |

## Local development

```bash
cd bot
cp .env.example .env    # fill in BOT_TOKEN, AI_API_KEY, MANAGER_CHAT_ID
npm install
npm run build           # generate catalog.json from web/js/data.js
npm run dev             # long polling, no public URL needed
```

Offline end-to-end checks — real updates through the bot with Telegram
stubbed and a scripted fake AI, so no token or credits are needed. Covers the
lead hold, hidden-phone and no-username paths, the manager relay, queued
messages and chat scoping:

```bash
cd bot && npm test
```

Verify everything without touching Telegram — catalog search, language
detection, deep links, HTML formatting, and real conversations against the
live AI (including a hot-lead escalation):

```bash
cd bot && npm run smoke
```

Serve the web app locally:

```bash
npx serve web -l 5177
```

## Deploying the bot to Render

1. Push this repo to GitHub.
2. Render Dashboard → **New → Blueprint** → pick this repo. It reads
   `render.yaml`.
3. Render prompts for the secrets marked `sync: false`:
   `BOT_TOKEN` and `AI_API_KEY` (from [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)).
   `WEBHOOK_SECRET` is generated automatically.
4. Deploy. On boot the app registers its own Telegram webhook using
   `RENDER_EXTERNAL_URL` — no manual `setWebhook` call needed.
5. Check `https://<service>.onrender.com/healthz`.

### Free-plan caveats

Render spins a free web service down after 15 minutes without inbound traffic,
and waking it takes about a minute — long enough to lose an impatient customer.
The app pings its own `/healthz` every 12 minutes (`KEEP_ALIVE=true`) to stay
warm. That works, but an external pinger (cron-job.org, UptimeRobot) hitting
`/healthz` every 10 minutes is more reliable; free Render cron jobs do not exist.
Free instances also share a 750 hour/month workspace budget.

## Configuration

Everything is environment-driven — see [bot/.env.example](bot/.env.example).
The ones worth knowing:

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_MODEL` | `deepseek-v4-flash` | `deepseek-v4-pro` for harder reasoning at higher latency/cost |
| `AI_BASE_URL` | `https://api.deepseek.com` | Any OpenAI-compatible provider — e.g. `https://openrouter.ai/api/v1` with an [OpenRouter model id](https://openrouter.ai/models). Switching providers is these two vars plus the key, no code change |
| `AI_TEMPERATURE` | `0.4` | Lower is more literal about prices and specs |
| `BOT_MODE` | webhook on Render, polling locally | |
| `KEEP_ALIVE` | `true` | Self-ping to defeat free-tier spin-down |
| `AI_HISTORY_TURNS` | `12` | Conversation turns replayed to the model |

The AI's behaviour — tone, catalog facts, and the rules for when to escalate a
lead — lives in [bot/src/ai/prompt.js](bot/src/ai/prompt.js). That is the file to
edit when the sales script changes.

## Known limits

- Conversation state is in memory. A redeploy resets every open conversation.
- The bot only works in private chats (plus the manager chat and the catalog
  channel); it ignores groups it is added to.
- The catalog snapshot is generated at build time; a price change on the website
  needs a rebuild and redeploy of the bot.
- The web app's language selector offers EN, but the bot answers only RU and UZ —
  English visitors get the Russian flow.
