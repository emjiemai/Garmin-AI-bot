/** Chat loop with tool calling.
 *
 *  DeepSeek and OpenRouter both expose OpenAI-compatible APIs, so the official
 *  `openai` SDK drives either one unmodified — the base URL, key and model
 *  name (see config.ai) are all that differ. */

import OpenAI from 'openai';
import { config } from '../config.js';
import { buildSystemPrompt } from './prompt.js';
import { TOOL_SCHEMAS, executeTool } from './tools.js';
import { trimHistory } from '../session.js';

const client = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseUrl,
  timeout: 45_000,
  maxRetries: 2,
  // Only OpenRouter asks for these (it uses them for per-app rate-limit
  // accounting); sending them to DeepSeek would just be noise.
  ...(config.ai.isOpenRouter
    ? {
        defaultHeaders: {
          'HTTP-Referer': config.business.siteUrl,
          'X-Title': 'Garmin Uzbekistan AI Bot'
        }
      }
    : {})
});

/**
 * Distinguishes "the AI is broken and will stay broken" (bad key, no credit)
 * from a transient blip. The first kind must be loud in the logs and must not
 * be retried per-message, and it means the customer has to reach a human.
 */
export function classifyAiError(err) {
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'upstream';
  if (err?.name === 'APIConnectionTimeoutError' || /timeout/i.test(err?.message ?? '')) {
    return 'timeout';
  }
  return 'unknown';
}

/** True when no amount of retrying will help — a human must take over. */
export function isFatalAiError(err) {
  return ['auth', 'billing'].includes(classifyAiError(err));
}

/** One-shot credential check so a bad key surfaces in the deploy log, not in
 *  front of a customer. Returns null when healthy, else a reason string. */
export async function checkAiHealth() {
  try {
    await client.chat.completions.create({
      model: config.ai.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    });
    return null;
  } catch (err) {
    return `${classifyAiError(err)}: ${err.message}`;
  }
}

function parseArgs(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[agent] unparseable tool arguments:', raw?.slice?.(0, 200));
    return {};
  }
}

/**
 * Runs one customer turn end to end: appends the message, lets the model call
 * tools until it produces prose, and returns the reply text.
 *
 * Mutates `session.history` so the next turn keeps context.
 *
 * @returns {Promise<{text: string, toolsUsed: string[]}>}
 */
export async function respond({ bot, session, user, userText }) {
  session.history.push({ role: 'user', content: userText });
  trimHistory(session, config.ai.historyTurns);

  // Work on this turn's array, not whatever `session.history` points at later:
  // a /reset or /start (a new web-app deep link) arriving mid-turn replaces
  // the array, and writing tool results into the fresh one would leave it
  // starting with orphaned tool messages the provider rejects outright.
  const history = session.history;
  const toolsUsed = [];

  for (let round = 0; round <= config.ai.maxToolRounds; round++) {
    // The system prompt is rebuilt each round so it reflects contact details
    // captured by save_customer_contact earlier in this very turn.
    const messages = [
      { role: 'system', content: buildSystemPrompt(session) },
      ...history
    ];

    const isLastRound = round === config.ai.maxToolRounds;

    const completion = await client.chat.completions.create({
      model: config.ai.model,
      messages,
      temperature: config.ai.temperature,
      max_tokens: config.ai.maxTokens,
      // On the final round drop the tools so the model is forced to answer.
      ...(isLastRound ? {} : { tools: TOOL_SCHEMAS, tool_choice: 'auto' })
    });

    const message = completion.choices?.[0]?.message;
    if (!message) throw new Error('AI provider returned no message');

    const calls = message.tool_calls ?? [];

    if (!calls.length) {
      const text = (message.content ?? '').trim();
      // An empty assistant message is rejected by some providers on the NEXT
      // request, which would break every later turn for this customer.
      history.push({ role: 'assistant', content: text || '[Технический сбой — ответ не сформирован.]' });
      return { text, toolsUsed };
    }

    // Tool-call messages must be replayed verbatim alongside their results.
    history.push({
      role: 'assistant',
      content: message.content ?? '',
      tool_calls: calls
    });

    for (const call of calls) {
      const name = call.function?.name;
      toolsUsed.push(name);

      let result;
      try {
        result = await executeTool(
          { name, args: parseArgs(call.function?.arguments) },
          { bot, session, user }
        );
      } catch (err) {
        console.error(`[agent] tool ${name} threw:`, err);
        result = { error: 'tool_failed', note: 'Инструмент недоступен. Ответь клиенту без этих данных.' };
      }

      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  // Unreachable in practice: the last round runs without tools.
  return { text: '', toolsUsed };
}
