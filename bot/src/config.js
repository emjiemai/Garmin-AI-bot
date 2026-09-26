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

/**
 * A number from the environment, or the fallback when the value is missing or
 * not a finite number within bounds. `Number("5 min")` is NaN, and a NaN lead
 * hold time makes setTimeout fire immediately — a typo in the dashboard must
 * not silently change behaviour.
 */
function num(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    console.warn(`[config] ${key}=${JSON.stringify(raw)} is not a valid number; using ${fallback}`);
    return fallback;
  }
  return value;
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

  /**
   * DeepSeek and OpenRouter are both OpenAI-compatible, so ai/agent.js needs
   * no provider-specific logic — switching between them is these three values
   * and nothing else. Anything that genuinely differs per provider (auth
   * headers, where to top up a balance) is derived from the base URL below
   * rather than hardcoded, so flipping back is one env var, not a code edit.
   */
  ai: {
    apiKey: required('AI_API_KEY'),
    baseUrl: optional('AI_BASE_URL', 'https://api.deepseek.com'),
    model: optional('AI_MODEL', 'deepseek-v4-flash'),
    temperature: num('AI_TEMPERATURE', 0.4, { min: 0, max: 2 }),
    maxTokens: num('AI_MAX_TOKENS', 900, { min: 64, max: 32_000 }),
    /** Safety valve on the tool-calling loop. */
    maxToolRounds: num('AI_MAX_TOOL_ROUNDS', 4, { min: 1, max: 10 }),
    /** How many prior turns of the conversation we replay to the model. */
    historyTurns: num('AI_HISTORY_TURNS', 12, { min: 1, max: 100 }),
    /** Where to fix a rejected key or an empty balance, for the boot-time
     *  banner and the smoke test — right for whichever provider is set. */
    get consoleUrl() {
      if (/openrouter\.ai/i.test(this.baseUrl)) return 'https://openrouter.ai/settings/keys';
      if (/deepseek\.com/i.test(this.baseUrl)) return 'https://platform.deepseek.com/api_keys';
      return this.baseUrl;
    },
    /** OpenRouter asks callers to identify themselves; nobody else wants it. */
    get isOpenRouter() {
      return /openrouter\.ai/i.test(this.baseUrl);
    }
  },

  server: {
    port: num('PORT', 3000, { min: 1, max: 65_535 }),
    /** Render injects RENDER_EXTERNAL_URL automatically. */
    publicUrl: optional('PUBLIC_URL', process.env.RENDER_EXTERNAL_URL ?? ''),
    /** webhook (production) or polling (local dev). */
    mode:
      optional('BOT_MODE', process.env.RENDER_EXTERNAL_URL ? 'webhook' : 'polling').trim().toLowerCase() === 'webhook'
        ? 'webhook'
        : 'polling',
    /** Free Render instances sleep after 15 min idle; ping ourselves to stay warm. */
    keepAlive: bool('KEEP_ALIVE', true),
    keepAliveMinutes: num('KEEP_ALIVE_MINUTES', 12, { min: 1, max: 14 })
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

  /** How long a buy-now lead waits for the customer's phone and pickup/delivery
   *  choice before going to the manager anyway. See leads/pending.js. */
  leadHoldMinutes: num('LEAD_HOLD_MINUTES', 5, { min: 0.5, max: 60 }),

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
