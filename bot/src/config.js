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

export const config = {
  telegram: {
    token: required('BOT_TOKEN'),
    /** Public username, used to build the t.me deep links the web app points at. */
    username: optional('BOT_USERNAME', 'garminofficialuzbot'),
    /** Shared secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token. */
    webhookSecret: optional('WEBHOOK_SECRET', ''),
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
    phone: optional('CONTACT_PHONE', '+998701203333')
  },

  /** Where lead JSONL is appended. Ephemeral on Render free — Telegram alerts
   *  to the manager are the durable record until a database is wired up. */
  leadsFile: optional('LEADS_FILE', './data/leads.jsonl')
};

export const DEEP_LINK_BASE = `https://t.me/${config.telegram.username}`;
