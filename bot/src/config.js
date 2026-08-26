/** Central env configuration. Fails fast on missing secrets so Render surfaces
 *  the problem in the deploy log rather than at the first customer message. */

function required(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Set it in .env locally or in the Render dashboard.`
    );
  }
  return value;
}

function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function bool(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Telegram accepts only 1-256 characters of [A-Za-z0-9_-] for `secret_token`,
 * but Render's `generateValue: true` emits standard base64, which includes
 * '+', '/' and '=' — setWebhook rejects it outright. Fold the value into
 * base64url so any generated secret works without hand-editing the dashboard.
 * The entropy is unchanged; this is a re-encoding, not a truncation.
 */
function webhookSecret(key) {
  const raw = optional(key, '');
  if (!raw) return '';

  const cleaned = raw
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 256);

  if (!cleaned) {
    console.warn(`[config] ${key} had no usable characters; webhook secret disabled`);
  }
  return cleaned;
}

export const config = {
  telegram: {
    token: required('BOT_TOKEN'),
    /** Public username, used to build the t.me deep links the web app points at. */
    username: optional('BOT_USERNAME', 'garminofficialuzbot'),
    /** Shared secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token. */
    webhookSecret: webhookSecret('WEBHOOK_SECRET'),
    managerChatId: required('MANAGER_CHAT_ID')
  },

  ai: {
    apiKey: required('DEEPSEEK_API_KEY'),
    baseUrl: optional('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    model: optional('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    temperature: Number(optional('DEEPSEEK_TEMPERATURE', '0.4')),
    maxTokens: Number(optional('DEEPSEEK_MAX_TOKENS', '900')),
    /** Safety valve on the tool-calling loop. */
    maxToolRounds: Number(optional('AI_MAX_TOOL_ROUNDS', '4')),
    /** How many prior turns of the conversation we replay to the model. */
    historyTurns: Number(optional('AI_HISTORY_TURNS', '12'))
  },

  server: {
    port: Number(optional('PORT', '3000')),
    /** Render injects RENDER_EXTERNAL_URL automatically. */
    publicUrl: optional('PUBLIC_URL', process.env.RENDER_EXTERNAL_URL ?? ''),
    /** webhook (production) or polling (local dev). */
    mode: optional('BOT_MODE', process.env.RENDER_EXTERNAL_URL ? 'webhook' : 'polling'),
    /** Free Render instances sleep after 15 min idle; ping ourselves to stay warm. */
    keepAlive: bool('KEEP_ALIVE', true),
    keepAliveMinutes: Number(optional('KEEP_ALIVE_MINUTES', '12'))
  },

  business: {
    webAppUrl: optional('WEBAPP_URL', 'https://garmin-insta-webpage.vercel.app'),
    siteUrl: optional('SITE_URL', 'https://www.garmin.com.uz'),
    catalogUrl: optional('CATALOG_URL', 'https://www.garmin.com.uz/catalog'),
    /** Public call center number — safe to put in buttons, shown to any customer. */
    phone: optional('CONTACT_PHONE', '+998701203333'),
    /** The manager's own direct line — only ever spoken in text (never baked
     *  into a button/link) and only on explicit /manager. Falls back to the
     *  public store number until this is set. */
    managerPhone: optional('MANAGER_PHONE', ''),
    /** Human-run Telegram channel, separate from this AI bot — an escape
     *  hatch for customers who want a person instead of the assistant. */
    humanTelegramUrl: optional('HUMAN_TELEGRAM_URL', 'https://t.me/Garmin_callcenter')
  },

  /** Where lead JSONL is appended. Ephemeral on Render free — Telegram alerts
   *  to the manager are the durable record until a database is wired up. */
  leadsFile: optional('LEADS_FILE', './data/leads.jsonl'),

  /**
   * The extended product catalog beyond watches (navigators, marine, cycling
   * computers, etc.) lives as photo+caption posts in this Telegram channel
   * rather than in the structured JSON catalog. The bot indexes posts made
   * there and can forward the matching one when a customer asks about that
   * product. Requires the bot to be added as an admin of the channel — that's
   * how Telegram delivers channel_post updates to it at all.
   */
  channelCatalog: {
    /** @username (with or without the leading @) or numeric chat id. */
    id: optional('CHANNEL_CATALOG_ID', '@cataloggarmintest'),
    /** Ephemeral on Render free, same caveat as leadsFile — rebuilds from
     *  whatever the bot is running to observe from this point forward. */
    file: optional('CHANNEL_CATALOG_FILE', './data/channel-catalog.jsonl')
  }
};

export const DEEP_LINK_BASE = `https://t.me/${config.telegram.username}`;
