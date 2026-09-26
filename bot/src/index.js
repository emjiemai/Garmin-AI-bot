/** Entry point.
 *
 *  On Render the bot runs as a web service behind a Telegram webhook. Locally
 *  (no RENDER_EXTERNAL_URL) it falls back to long polling so you can develop
 *  without a public URL or a tunnel. */

import { createHash } from 'node:crypto';
import express from 'express';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { bot } from './bot.js';
import { catalog } from './catalog/catalog.js';
import { checkAiHealth } from './ai/agent.js';

const app = express();
app.disable('x-powered-by');

const startedAt = Date.now();

/** How long a webhook request waits on the handler — see main() for why. */
const WEBHOOK_TIMEOUT_MS = 45_000;
/** Result of the boot-time AI credential check, reported by /healthz. */
let aiHealthy = null;
/** Why it failed, so "degraded" can be diagnosed without Render's logs —
 *  a rejected key and an empty balance need completely different fixes. */
let aiProblemReason = null;

/** Updates the bot subscribes to. edited_channel_post keeps the channel
 *  catalog current when a product post's price or text is corrected. */
const ALLOWED_UPDATES = ['message', 'callback_query', 'channel_post', 'edited_channel_post'];

/** Render's health check and the keep-alive pinger both hit this. Always 200:
 *  a failing health check makes Render tear the service down, and the bot is
 *  still useful (manager escalation, showrooms) even with the AI degraded.
 *  This URL is public — lead counts and chat numbers are business data and
 *  live in the manager-only /stats command, not here. */
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    mode: config.server.mode,
    ai: aiHealthy === null ? 'unchecked' : aiHealthy ? 'ok' : 'degraded',
    model: config.ai.model,
    // Providers mask keys in these messages; truncated regardless.
    ...(aiProblemReason ? { aiError: aiProblemReason.slice(0, 200), fixAt: config.ai.consoleUrl } : {}),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    products: catalog.products.length
  });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send(`Garmin Uzbekistan AI bot — @${config.telegram.username}`);
});

/**
 * Surfaces a dead API key in the deploy log rather than letting a customer
 * discover it. Not fatal: /manager, showrooms and the escalation fallback all
 * still work without the AI, so a bad key must not take the whole bot down.
 * Runs in the background — with the SDK's retries it can take minutes, and
 * boot must not wait on it (Render fails a deploy whose port never opens).
 */
async function reportAiHealth() {
  const aiProblem = await checkAiHealth();
  if (aiProblem) {
    console.error(
      `\n${'!'.repeat(72)}\n` +
        `[ai] ${config.ai.model} is NOT usable — ${aiProblem}\n` +
        `[ai] Customers will be handed straight to a manager until this is fixed.\n` +
        `[ai] Check AI_API_KEY and the account balance at ${config.ai.consoleUrl}\n` +
        `${'!'.repeat(72)}\n`
    );
  } else {
    console.log(`[ai] ${config.ai.model} reachable via ${config.ai.baseUrl}`);
  }
  aiHealthy = !aiProblem;
  aiProblemReason = aiProblem;
}

/** A wrong MANAGER_CHAT_ID, or a manager who never pressed Start in the bot,
 *  means every lead alert fails. Say so at boot, not after the first lost lead. */
async function checkManagerChat() {
  try {
    await bot.api.getChat(config.telegram.managerChatId);
    console.log(`[bot] manager chat ${config.telegram.managerChatId} reachable`);
  } catch (err) {
    console.error(
      `\n${'!'.repeat(72)}\n` +
        `[bot] MANAGER_CHAT_ID=${config.telegram.managerChatId} is NOT reachable — ${err.message}\n` +
        `[bot] Lead alerts will fail. The manager must open the bot and press Start\n` +
        `[bot] (or add it to the group), and MANAGER_CHAT_ID must be that chat's id.\n` +
        `${'!'.repeat(72)}\n`
    );
  }
}

async function main() {
  await bot.init();

  await bot.api
    .setMyCommands([
      { command: 'start', description: 'Начать / Boshlash' },
      { command: 'lang', description: 'Язык / Til (RU / UZ)' },
      { command: 'manager', description: 'Связаться с менеджером / Menejer bilan' },
      { command: 'reset', description: 'Очистить диалог / Suhbatni tozalash' },
      { command: 'help', description: 'Помощь / Yordam' }
    ])
    .catch((err) => console.warn('[bot] setMyCommands failed:', err.message));

  if (config.server.mode === 'webhook') {
    if (!config.server.publicUrl) {
      throw new Error('BOT_MODE=webhook requires PUBLIC_URL (or RENDER_EXTERNAL_URL).');
    }

    // Unguessable but derived, not secret material: hashing means the path can
    // appear in logs and proxy access records without leaking the bot token.
    const path = `/webhook/${createHash('sha256').update(config.telegram.token).digest('hex').slice(0, 32)}`;

    app.post(
      path,
      express.json(),
      webhookCallback(bot, 'express', {
        secretToken: config.telegram.webhookSecret || undefined,
        // grammy's default is 10s with onTimeout:"throw" — Express 5 turns that
        // rejection into a 500, and Telegram logs it as "Wrong response from
        // the webhook". Measured against the real model (Gemini 3.8 Flash has
        // mandatory reasoning): ordinary multi-tool-call turns took 8-21s in
        // testing, so 25s left uncomfortably little margin. Raised further, and
        // a true timeout is still non-fatal: Telegram gets 200 immediately, the
        // reply just arrives whenever it's ready instead of the exchange
        // being dropped.
        timeoutMilliseconds: WEBHOOK_TIMEOUT_MS,
        onTimeout: () =>
          console.warn(
            `[webhook] update exceeded ${WEBHOOK_TIMEOUT_MS / 1000}s — replying in the background instead of failing the request`
          )
      })
    );

    app.listen(config.server.port, () => {
      console.log(`[server] listening on :${config.server.port}`);
    });

    const url = `${config.server.publicUrl.replace(/\/$/, '')}${path}`;
    await bot.api.setWebhook(url, {
      secret_token: config.telegram.webhookSecret || undefined,
      // Never drop: on Render's free tier the message that WAKES a sleeping
      // instance is exactly the one Telegram is still holding while we boot.
      // Dropping pending updates here threw away that customer's first
      // message on every cold start and every deploy. A late answer beats
      // no answer.
      drop_pending_updates: false,
      allowed_updates: ALLOWED_UPDATES
    });
    console.log(`[bot] webhook set: ${url}`);

    if (config.server.keepAlive) startKeepAlive();
  } else {
    app.listen(config.server.port, () => {
      console.log(`[server] listening on :${config.server.port} (health only)`);
    });

    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log('[bot] starting long polling');
    bot.start({
      allowed_updates: ALLOWED_UPDATES,
      onStart: (me) => console.log(`[bot] polling as @${me.username}`)
    });
  }

  console.log(
    `[bot] ready — @${bot.botInfo.username}, ${catalog.products.length} products, model ${config.ai.model}`
  );

  reportAiHealth().catch((err) => console.error('[ai] health check crashed:', err));
  checkManagerChat();
}

/**
 * Render spins a free web service down after 15 minutes without inbound
 * traffic, and the cold start costs the customer roughly a minute. Pinging our
 * own public URL counts as inbound traffic and keeps the instance warm.
 * An external pinger (cron-job.org, UptimeRobot) is more reliable — this is the
 * zero-setup fallback. Set KEEP_ALIVE=false to disable.
 */
function startKeepAlive() {
  const url = `${config.server.publicUrl.replace(/\/$/, '')}/healthz`;
  const everyMs = config.server.keepAliveMinutes * 60 * 1000;

  const timer = setInterval(async () => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      console.warn('[keepalive] ping failed:', err.message);
    }
  }, everyMs);
  timer.unref?.();

  console.log(`[keepalive] pinging ${url} every ${config.server.keepAliveMinutes} min`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log(`[bot] ${signal} received, shutting down`);
    try {
      await bot.stop();
    } catch {
      /* polling may not be running */
    }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
