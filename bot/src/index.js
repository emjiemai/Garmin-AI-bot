/** Entry point.
 *
 *  On Render the bot runs as a web service behind a Telegram webhook. Locally
 *  (no RENDER_EXTERNAL_URL) it falls back to long polling so you can develop
 *  without a public URL or a tunnel. */

import express from 'express';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { bot } from './bot.js';
import { catalog } from './catalog/catalog.js';
import { sessionCount } from './session.js';
import { leadStats } from './leads/store.js';

const app = express();
app.disable('x-powered-by');

const startedAt = Date.now();

/** Render's health check and the keep-alive pinger both hit this. */
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    mode: config.server.mode,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    products: catalog.products.length,
    activeChats: sessionCount(),
    leads: leadStats()
  });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send(`Garmin Uzbekistan AI bot — @${config.telegram.username}`);
});

async function main() {
  await bot.init();

  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать / Boshlash' },
    { command: 'lang', description: 'Язык / Til (RU / UZ)' },
    { command: 'manager', description: 'Связаться с менеджером / Menejer bilan' },
    { command: 'reset', description: 'Очистить диалог / Suhbatni tozalash' },
    { command: 'help', description: 'Помощь / Yordam' }
  ]);

  if (config.server.mode === 'webhook') {
    if (!config.server.publicUrl) {
      throw new Error('BOT_MODE=webhook requires PUBLIC_URL (or RENDER_EXTERNAL_URL).');
    }

    const path = `/webhook/${config.telegram.token.split(':')[1].slice(0, 16)}`;

    app.post(
      path,
      express.json(),
      webhookCallback(bot, 'express', {
        secretToken: config.telegram.webhookSecret || undefined
      })
    );

    app.listen(config.server.port, () => {
      console.log(`[server] listening on :${config.server.port}`);
    });

    const url = `${config.server.publicUrl.replace(/\/$/, '')}${path}`;
    await bot.api.setWebhook(url, {
      secret_token: config.telegram.webhookSecret || undefined,
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query']
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
      allowed_updates: ['message', 'callback_query'],
      onStart: (me) => console.log(`[bot] polling as @${me.username}`)
    });
  }

  console.log(
    `[bot] ready — @${bot.botInfo.username}, ${catalog.products.length} products, model ${config.ai.model}`
  );
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
