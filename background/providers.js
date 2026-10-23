/* GuteAyri — provider adapters (the ChatGPT sign-in itself is in shared/chatgpt.js).
   Every call takes a provider-neutral list of parts:
     { type: "text", text } | { type: "image", mime, data (base64), label }
   and returns { text, model }. */

class GuteAyriError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code || "error";
    this.status = status || 0;
  }
}

const REQUEST_TIMEOUT_MS = 240000;

/* Each attempt relaxes the request a little further, so a model that rejects
   a parameter (reasoning effort, JSON mode, images) still gets answered. */
const ATTEMPTS = [
  { reasoning: true, json: true, images: true, extras: true },
  { reasoning: false, json: true, images: true, extras: false },
  { reasoning: false, json: false, images: true, extras: false },
  { reasoning: false, json: false, images: false, extras: false },
];

const MAX_OUTPUT_TOKENS = 64000;
const TRANSIENT = new Set([429, 500, 502, 503, 504, 529]);
const TOKEN_LIMIT_ERROR = /max_tokens|max_completion_tokens|maxOutputTokens|max_output|maximum[^.]*tokens|tokens[^.]*(maximum|exceed|too large)/i;

function providerConfig(settings, providerId, { keyOptional = false } = {}) {
  const id = providerId || settings.provider;
  const def = GUTEAYRI_PROVIDERS[id];
  if (!def) throw new GuteAyriError("Unknown provider: " + id, "config");
  const cfg = (settings.providers && settings.providers[id]) || {};
  const baseUrl = String(cfg.baseUrl || def.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(cfg.model || def.defaultModel || "").trim();
  const apiKey = String(cfg.apiKey || "").trim();
  const workspaceId = String(cfg.workspaceId || "").trim();
  if (!baseUrl) throw new GuteAyriError(`Add a base URL for ${def.name} in Settings.`, "config");
  if (def.needsKey && !apiKey && !keyOptional) throw new GuteAyriError(`Add your ${def.name} API key in Settings.`, "no-key");
  return { id, def, baseUrl, model, apiKey, workspaceId };
}

async function guteayriCall(settings, { system, parts, json = true, maxTokens = 16000 }) {
  const p = providerConfig(settings);
  if (!p.model) throw new GuteAyriError(`Choose a model for ${p.def.name} in Settings.`, "config");
  const level = settings.reasoning || "medium";
  const choices = reasoningChoices(p, level);
  let imageCap = p.def.maxImages || Infinity;
  let tokens = maxTokens;
  let lastErr = null;
  // Tokens billed across every attempt that produced output (cut-off answers are billed too).
  const spent = { input: 0, output: 0, cached: 0, cost: 0, costKnown: true };
  const count = (u) => {
    if (!u) return;
    for (const k of ["input", "output", "cached"]) spent[k] += u[k] || 0;
    // A price is only shown when every billed attempt had one.
    if (typeof u.cost === "number") spent.cost += u.cost;
    else if (u.input || u.output) spent.costKnown = false;
  };

  for (let i = 0; i < ATTEMPTS.length; i++) {
    const opts = Object.assign({}, ATTEMPTS[i]);
    if (!json) opts.json = false;
    if (!p.def.vision || imageCap === 0) opts.images = false;
    // The image-free attempt only exists for requests that carried images.
    if (!ATTEMPTS[i].images && !(p.def.vision && hasImages(parts))) continue;
    // A model that caps its output below our limit says so; ask for less from then on.
    if (lastErr && TOKEN_LIMIT_ERROR.test(lastErr.message) && lastErr.code !== "truncated") tokens = Math.min(tokens, 8192);

    let choice = 0, waits = 0, grows = 0;
    for (;;) {
      opts.reasoningPatch = opts.reasoning ? choices[choice] || null : null;
      try {
        const { text, usage } = await dispatch(p, { system, parts: capImages(parts, opts.images ? imageCap : 0), maxTokens: tokens, opts });
        count(usage);
        const dropped = hasImages(parts) && (!opts.images || imageCap < countImages(parts));
        return { text, model: p.model, provider: p.def.name, imagesDropped: dropped, usage: spent };
      } catch (err) {
        lastErr = err;
        count(err.usage);
        if (err.code === "truncated" && grows < 2 && tokens < MAX_OUTPUT_TOKENS) {
          tokens = Math.min(MAX_OUTPUT_TOKENS, tokens * 2);
          grows++;
          continue;
        }
        if ((TRANSIENT.has(err.status) || err.code === "network") && err.code !== "limit" && waits < 2) {
          await new Promise((r) => setTimeout(r, waits ? 6000 : 2000));
          waits++;
          continue;
        }
        if (err.status === 413 && opts.images && imageCap > 0) {
          imageCap = Math.min(imageCap, countImages(parts)) >> 1;
          if (imageCap === 0) opts.images = false;
          continue;
        }
        // The model may know a different name for the same reasoning level.
        if (opts.reasoningPatch && err.status === 400 && /reason|effort|thinking/i.test(err.message) && choice + 1 < choices.length) {
          choice++;
          continue;
        }
        break;
      }
    }
    const retryable = (lastErr.status === 400 || lastErr.status === 413 || lastErr.status === 422 || lastErr.code === "empty") &&
      !["workspace", "auth", "limit", "refusal", "model"].includes(lastErr.code);
    if (!retryable) throw lastErr;
  }
  throw lastErr || new GuteAyriError("The model did not return an answer.", "empty");
}

/* ---------- Backup keys, fallback providers and the request log ---------- */

/* Errors another key for the same provider can get past: a rejected or used-up key, or one that is rate-limited. */
const KEY_ERRORS = new Set(["auth", "limit", "rate", "workspace"]);

/* Each provider and key to try, in order: the chosen provider's keys, then each fallback provider's.
   A provider without keys (Ollama, Sign in with ChatGPT, a keyless endpoint) gets a single attempt. */
function guteayriAttempts(settings) {
  const ids = [settings.provider, ...(settings.fallbacks || [])].filter((id, i, all) => GUTEAYRI_PROVIDERS[id] && all.indexOf(id) === i);
  const out = [];
  for (const id of ids) {
    const cfg = (settings.providers && settings.providers[id]) || {};
    const keys = [cfg.apiKey, ...(cfg.backupKeys || [])].map((k) => String(k || "").trim()).filter(Boolean);
    if (!keys.length) out.push({ id, key: "", keyNo: 0, fallback: id !== settings.provider });
    keys.forEach((key, i) => out.push({ id, key, keyNo: i + 1, fallback: id !== settings.provider }));
  }
  return out;
}

/* The same settings, pointed at one provider and key. */
function settingsFor(settings, attempt) {
  const cfg = Object.assign({}, settings.providers[attempt.id], { apiKey: attempt.key });
  return Object.assign({}, settings, { provider: attempt.id, providers: Object.assign({}, settings.providers, { [attempt.id]: cfg }) });
}

const keyHint = (key) => (key && key.length > 8 ? `…${key.slice(-4)}` : "");

/* Runs `run(settings)` against each provider and key in turn until one succeeds, logging every attempt.
   `what` names the request in the log ("page", "question", "test"). */
async function guteayriWithFallback(settings, what, run) {
  const attempts = guteayriAttempts(settings);
  let first = null, skip = null, tried = 0;
  for (const a of attempts) {
    if (a.id === skip) continue;
    const s = settingsFor(settings, a);
    const def = GUTEAYRI_PROVIDERS[a.id];
    const model = (s.providers[a.id].model || def.defaultModel || "").trim();
    const started = Date.now();
    tried++;
    try {
      const result = await run(s);
      guteayriLog({ what, provider: a.id, keyNo: a.keyNo, keyHint: keyHint(a.key), model: result.model || model, ok: true, ms: Date.now() - started, usage: result.usage });
      // keyNo 1 is the main key; the backups after it are numbered from 1 as in Settings.
      const via = a.fallback ? `fallback: ${def.name}` : a.keyNo > 1 ? `backup key ${a.keyNo - 1}` : "";
      return Object.assign(result, { via, provider: def.name, model: via ? `${result.model} (${via})` : result.model });
    } catch (err) {
      guteayriLog({ what, provider: a.id, keyNo: a.keyNo, keyHint: keyHint(a.key), model, ok: false, ms: Date.now() - started, code: err.code, status: err.status, error: err.message, usage: err.usage });
      if (!first) first = err;
      // Another key only helps when this key was the problem; otherwise go on to the next provider.
      if (!KEY_ERRORS.has(err.code) || !a.key) skip = a.id;
    }
  }
  if (first && tried > 1) first.message += ` GuteAyri also tried ${tried - 1} more ${tried - 1 === 1 ? "key or provider" : "keys and providers"}; see Settings → Log for each one.`;
  throw first || new GuteAyriError("No provider is set up. Choose one in Settings.", "config");
}

/* The request log: the last 200 attempts, newest first, kept in this browser only. Keys are never stored, only their last 4 characters. */
const LOG_KEY = "requestLog";
const LOG_MAX = 200;
let logWrite = Promise.resolve();
function guteayriLog(entry) {
  const row = Object.assign({ t: Date.now() }, entry);
  if (row.error) row.error = String(row.error).slice(0, 400);
  if (row.usage) row.usage = { input: row.usage.input || 0, output: row.usage.output || 0 };
  // Writes go one after another, so parallel requests (several frames) don't overwrite each other's rows.
  logWrite = logWrite.then(async () => {
    const stored = (await browser.storage.local.get(LOG_KEY))[LOG_KEY] || [];
    await browser.storage.local.set({ [LOG_KEY]: [row, ...stored].slice(0, LOG_MAX) });
  }).catch(() => {});
  return logWrite;
}

/* Tries every key of one provider (no fallbacks), for Test connection: which keys work and which don't. */
async function guteayriTestKeys(settings, request) {
  const attempts = guteayriAttempts(Object.assign({}, settings, { fallbacks: [] }));
  const results = [];
  for (const a of attempts) {
    const started = Date.now();
    try {
      const r = await guteayriCall(settingsFor(settings, a), request);
      guteayriLog({ what: "test", provider: a.id, keyNo: a.keyNo, keyHint: keyHint(a.key), model: r.model, ok: true, ms: Date.now() - started, usage: r.usage });
      results.push({ keyNo: a.keyNo, ok: true, model: r.model });
    } catch (err) {
      guteayriLog({ what: "test", provider: a.id, keyNo: a.keyNo, keyHint: keyHint(a.key), model: settings.providers[a.id].model, ok: false, ms: Date.now() - started, code: err.code, status: err.status, error: err.message });
      results.push({ keyNo: a.keyNo, ok: false, error: err.message, code: err.code });
    }
  }
  return results;
}

function withUsage(err, usage) {
  err.usage = usage;
  return err;
}

function countImages(parts) {
  return parts.filter((x) => x.type === "image").length;
}

/* Keeps the first `cap` images; the rest become a note so the model knows they existed. */
function capImages(parts, cap) {
  let n = 0;
  return parts.map((x) => {
    if (x.type !== "image") return x;
    n++;
    return n <= cap ? x : { type: "text", text: `[${x.label || "image"} could not be sent to this model]` };
  });
}

/* Each reasoning level as the request fields a provider expects, best first. Later
   entries are other names for the same level, tried if the model rejects the first. */
function reasoningChoices(p, level) {
  const style = p.def.reasoning;
  const pick = (map) => map[level] || map.medium;
  if (style === "openai" || style === "xai") {
    // Older Grok models reject reasoning_effort outright.
    if (style === "xai" && !/grok-(3-mini|4\.\d|[5-9])/i.test(p.model)) return [];
    // Only OpenAI's own models know "none"/"minimal" and "xhigh"; elsewhere Off leaves the model's default.
    const own = p.id === "openai" || p.id === "chatgpt" || style === "xai";
    if (level === "off" && !own) return [];
    if (style === "xai" && level === "off") return [];
    const efforts = pick({ off: ["none", "minimal"], low: ["low"], medium: ["medium"], high: ["high"], max: own ? ["xhigh", "high"] : ["high"] });
    return efforts.map((e) => ({ reasoning_effort: e }));
  }
  if (style === "openrouter") {
    if (level === "off") return [{ reasoning: { effort: "none" } }, { reasoning: { enabled: false } }];
    return pick({ low: ["low"], medium: ["medium"], high: ["high"], max: ["xhigh", "high"] }).map((e) => ({ reasoning: { effort: e } }));
  }
  if (style === "deepseek") {
    if (level === "off") return [{ thinking: { type: "disabled" } }];
    return pick({ low: ["low"], medium: ["high"], high: ["high"], max: ["max", "high"] }).map((e) => ({ thinking: { type: "enabled" }, reasoning_effort: e }));
  }
  if (style === "anthropic") {
    // Current Claude models take adaptive thinking plus an effort level; Off uses the lowest effort without thinking.
    const effort = { off: "low", low: "low", medium: "medium", high: "high", max: "max" }[level] || "medium";
    return [level === "off" ? { output_config: { effort } } : { output_config: { effort }, thinking: { type: "adaptive" } }];
  }
  if (style === "gemini") {
    if (/gemini-(1|2)\./i.test(p.model)) {
      // 2.x takes a token budget; 2.5 Pro can't switch thinking off entirely.
      const off = /2\.5-pro/i.test(p.model) ? 128 : 0;
      const budget = { off, low: 1024, medium: 8192, high: 24576, max: -1 }[level];
      return [{ thinkingBudget: budget === undefined ? 8192 : budget }];
    }
    const levels = pick({ off: ["minimal", "low"], low: ["low"], medium: ["medium", "high"], high: ["high"], max: ["high"] });
    return levels.map((l) => ({ thinkingLevel: l }));
  }
  return [];
}

function hasImages(parts) {
  return parts.some((x) => x.type === "image");
}

function dispatch(p, req) {
  if (p.def.kind === "anthropic") return callAnthropic(p, req);
  if (p.def.kind === "gemini") return callGemini(p, req);
  if (p.def.kind === "chatgpt") return callChatGPT(p, req);
  return callOpenAICompatible(p, req);
}

/* ---------- OpenAI and OpenAI-compatible (OpenRouter, xAI, Groq, Mistral, DeepSeek, Ollama, custom) ---------- */

async function callOpenAICompatible(p, { system, parts, maxTokens, opts }) {
  const content = [];
  for (const part of parts) {
    if (part.type === "text") content.push({ type: "text", text: part.text });
    else if (opts.images) content.push({ type: "image_url", image_url: { url: `data:${part.mime};base64,${part.data}`, detail: "high" } });
    else content.push({ type: "text", text: `[${part.label || "image"} could not be sent to this model]` });
  }
  const userContent = content.every((c) => c.type === "text") ? content.map((c) => c.text).join("\n\n") : content;

  const body = {
    model: p.model,
    messages: [
      // OpenRouter passes cache breakpoints on to Claude; the other providers cache repeated prefixes on their own.
      { role: "system", content: p.id === "openrouter" && /anthropic\/|claude/i.test(p.model) ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system },
      { role: "user", content: userContent },
    ],
  };
  if (p.id === "openai") body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  if (opts.json) body.response_format = { type: "json_object" };
  // OpenRouter reports what each request cost.
  if (p.id === "openrouter") body.usage = { include: true };
  if (opts.reasoningPatch) Object.assign(body, opts.reasoningPatch);

  const headers = { "content-type": "application/json" };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  if (p.id === "openrouter") {
    headers["X-Title"] = "GuteAyri";
  }

  const data = await postJson(p, `${p.baseUrl}/chat/completions`, headers, body);
  const choice = data && data.choices && data.choices[0];
  const msg = choice && choice.message;
  if (msg && msg.refusal) throw new GuteAyriError(`${p.def.name} declined this page: ${msg.refusal}`, "refusal");
  let text = msg ? msg.content : "";
  if (Array.isArray(text)) text = text.map((c) => c.text || "").join("");
  const u = data.usage || {};
  const usage = {
    input: u.prompt_tokens || 0,
    output: u.completion_tokens || 0,
    cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.prompt_cache_hit_tokens || 0,
    cost: p.id === "openrouter" && typeof u.cost === "number" ? u.cost : null,
  };
  if (choice && choice.finish_reason === "length") throw withUsage(new GuteAyriError(`${p.def.name} ran out of room before finishing the answer.`, "truncated"), usage);
  if (!text) throw withUsage(new GuteAyriError(`${p.def.name} returned an empty answer.`, "empty"), usage);
  return { text, usage };
}

/* ---------- ChatGPT plan (Sign in with ChatGPT) ---------- */

/* The plan route takes the Responses API with store: false and stream: true, and rejects
   max_output_tokens, temperature and system-role messages, so the instructions go in `instructions`. */
async function callChatGPT(p, { system, parts, opts }) {
  const content = [];
  for (const part of parts) {
    if (part.type === "text") content.push({ type: "input_text", text: part.text });
    else if (opts.images) content.push({ type: "input_image", image_url: `data:${part.mime};base64,${part.data}`, detail: "high" });
    else content.push({ type: "input_text", text: `[${part.label || "image"} could not be sent to this model]` });
  }
  const body = {
    model: p.model,
    instructions: system,
    input: [{ type: "message", role: "user", content }],
    store: false,
    stream: true,
  };
  if (opts.json) body.text = { format: { type: "json_object" } };
  if (opts.reasoningPatch && opts.reasoningPatch.reasoning_effort) body.reasoning = { effort: opts.reasoningPatch.reasoning_effort };

  let res;
  for (let renewed = false; ; renewed = true) {
    const token = await chatgptAccessToken();
    res = await openStream(p, `${p.baseUrl}/responses`, { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${token}` }, body);
    if (res.ok) break;
    clearTimeout(res.guteayriTimer);
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { /* plain-text error */ }
    // An access token the API no longer takes: renew it once before giving up.
    if (res.status === 401 && !renewed) {
      await chatgptDropAccess();
      continue;
    }
    const e = (data && data.error) || {};
    throw chatgptError(p, res.status, e.code, e.message || (data && data.detail), e.param) || httpError(p, res.status, data, raw);
  }

  let text = "", final = null;
  await readEvents(p, res, (ev) => {
    if (ev.type === "response.output_text.delta") text += ev.delta || "";
    else if (/^response\.(completed|failed|incomplete)$/.test(ev.type) || ev.type === "error") final = ev;
  });
  const r = (final && final.response) || {};
  const u = r.usage || {};
  const usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cached: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0, cost: null };
  if (!final) throw withUsage(new GuteAyriError("ChatGPT's answer was cut off before it finished. Run again.", "network"), usage);
  if (final.type === "error" || final.type === "response.failed") {
    const e = final.type === "error" ? final.error || final : r.error || {};
    throw withUsage(chatgptError(p, 0, e.code, e.message, e.param) || new GuteAyriError(`ChatGPT couldn't answer: ${e.message || e.code || "unknown error"}`, "http"), usage);
  }
  if (final.type === "response.incomplete") {
    const why = (r.incomplete_details && r.incomplete_details.reason) || "unknown reason";
    if (why === "content_filter") throw withUsage(new GuteAyriError("ChatGPT declined this page.", "refusal"), usage);
    throw withUsage(new GuteAyriError(`ChatGPT stopped before finishing the answer (${why}).`, "incomplete"), usage);
  }
  if (!text) {
    // No deltas came through: read the text from the finished response instead.
    text = (r.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []).map((c) => c.text || c.refusal || "").join("");
  }
  if (!text) throw withUsage(new GuteAyriError("ChatGPT returned an empty answer.", "empty"), usage);
  return { text, usage };
}

/* The plan route's own error codes; null for anything the general handling covers. */
function chatgptError(p, status, code, message, param) {
  const detail = message || code || "";
  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return new GuteAyriError(`You've used the share of your ChatGPT plan that GuteAyri may use for now. Check or raise the limit at ${CHATGPT_AUTH.usageUrl}`, "limit", status || 429);
    case "subscription_sharing_user_not_eligible":
      return new GuteAyriError(`This ChatGPT account or workspace can't use its plan in other apps. (${detail})`, "auth", status || 403);
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return new GuteAyriError("ChatGPT couldn't check your plan's usage just now. Run again in a moment.", "http", 503);
    case "subscription_sharing_invalid_user":
    case "chatpass_v2_scope_not_authorized":
    case "chatpass_v2_invalid_authorization_context":
      return new GuteAyriError("ChatGPT didn't accept the sign-in. Sign in again in Settings.", "auth", status || 401);
    case "subscription_sharing_unsupported_capability":
      // A 400 lets the retry ladder drop images, JSON mode or the reasoning level.
      return new GuteAyriError(`ChatGPT doesn't support part of this request${param ? ` (${param})` : ""}. ${detail}`, "http", 400);
  }
  if (status === 401) return new GuteAyriError("ChatGPT didn't accept the sign-in. Sign in again in Settings.", "auth", 401);
  if (status === 403 && !code) return new GuteAyriError(`ChatGPT refused this request: ${detail || "not allowed for this account or region"}.`, "auth", 403);
  return null;
}

/* ---------- Anthropic Messages API ---------- */

/* Claude prices in dollars per million tokens: input, output, cache read. Cache writes cost 1.25×
   input. Haiku 5.5 costs more for prompts over 100K tokens. Unknown models get no price. */
const CLAUDE_PRICES = [
  [/^claude-(fable|mythos)-5-1/, 10, 50, 0.25],
  [/^claude-(fable|mythos)-5/, 10, 50, 1],
  [/^claude-opus-5-5/, 4, 20, 0.2],
  [/^claude-opus-(5|4-[5-8])/, 5, 25, 0.5],
  [/^claude-sonnet-5/, 2, 10, 0.2],
  [/^claude-sonnet-4-[56]/, 3, 15, 0.3],
  [/^claude-haiku-5-5/, 0.1, 0.5, 0.01],
  [/^claude-haiku-4-5/, 1, 5, 0.1],
];

function claudeCost(model, u) {
  const row = CLAUDE_PRICES.find(([re]) => re.test(model || ""));
  if (!row) return null;
  let [, input, output, read] = row;
  const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  if (/^claude-haiku-5-5/.test(model) && prompt > 100000) [input, output, read] = [0.5, 2.5, 0.05];
  return ((u.input_tokens || 0) * input + (u.cache_creation_input_tokens || 0) * input * 1.25 + (u.cache_read_input_tokens || 0) * read + (u.output_tokens || 0) * output) / 1e6;
}

const ANTHROPIC_FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/;

async function callAnthropic(p, { system, parts, maxTokens, opts }) {
  const content = [];
  for (const part of parts) {
    if (part.type === "text") content.push({ type: "text", text: part.text });
    else if (opts.images) content.push({ type: "image", source: { type: "base64", media_type: part.mime, data: part.data } });
    else content.push({ type: "text", text: `[${part.label || "image"} could not be sent to this model]` });
  }

  const body = {
    model: p.model,
    max_tokens: maxTokens,
    // The instructions and topic notes are the same for every page, so later pages read them from the cache.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  };
  // Older models reject the reasoning fields; the retry ladder then drops them.
  if (opts.reasoningPatch) Object.assign(body, opts.reasoningPatch);

  const headers = {
    "content-type": "application/json",
    "x-api-key": p.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  // Organization-scoped keys must name the workspace each request is billed to.
  if (p.workspaceId) headers["anthropic-workspace-id"] = p.workspaceId;
  // Server-side fallback: if the model declines, the API reroutes the same request.
  if (opts.extras && ANTHROPIC_FALLBACK_MODELS.test(p.model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }

  const data = await postJson(p, `${p.baseUrl}/messages`, headers, body);
  if (data.stop_reason === "refusal") {
    const why = data.stop_details && data.stop_details.explanation;
    throw new GuteAyriError(`Claude declined this page${why ? ": " + why : "."}`, "refusal");
  }
  const u = data.usage || {};
  const usage = {
    input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    output: u.output_tokens || 0,
    cached: u.cache_read_input_tokens || 0,
    // Priced by the model that answered (a fallback may answer instead of the one asked for).
    cost: claudeCost(data.model || p.model, u),
  };
  if (data.stop_reason === "max_tokens") throw withUsage(new GuteAyriError("Claude ran out of room before finishing the answer.", "truncated"), usage);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw withUsage(new GuteAyriError("Claude returned an empty answer.", "empty"), usage);
  return { text, usage };
}

/* ---------- Google Gemini ---------- */

async function callGemini(p, { system, parts, maxTokens, opts }) {
  const gParts = [];
  for (const part of parts) {
    if (part.type === "text") gParts.push({ text: part.text });
    else if (opts.images) gParts.push({ inline_data: { mime_type: part.mime, data: part.data } });
    else gParts.push({ text: `[${part.label || "image"} could not be sent to this model]` });
  }
  // Gemini counts thinking against the output limit, so it gets at least twice the room.
  const generationConfig = { maxOutputTokens: maxTokens <= 8192 ? maxTokens : Math.max(maxTokens * 2, 32000) };
  if (opts.json) generationConfig.responseMimeType = "application/json";
  if (opts.reasoningPatch) generationConfig.thinkingConfig = opts.reasoningPatch;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: gParts }],
    generationConfig,
  };
  const model = p.model.replace(/^models\//, "");
  const url = `${p.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  const data = await postJson(p, url, { "content-type": "application/json", "x-goog-api-key": p.apiKey }, body);

  const cand = data.candidates && data.candidates[0];
  if (!cand) {
    const block = data.promptFeedback && data.promptFeedback.blockReason;
    throw new GuteAyriError(block ? `Gemini blocked this page (${block}).` : "Gemini returned no answer.", block ? "refusal" : "empty");
  }
  if (/^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION)$/.test(cand.finishReason || "")) {
    throw new GuteAyriError(`Gemini declined this page (${cand.finishReason}).`, "refusal");
  }
  const u = data.usageMetadata || {};
  const usage = { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cached: u.cachedContentTokenCount || 0 };
  if (cand.finishReason === "MAX_TOKENS") throw withUsage(new GuteAyriError("Gemini ran out of room before finishing the answer.", "truncated"), usage);
  const text = ((cand.content && cand.content.parts) || []).filter((x) => !x.thought).map((x) => x.text || "").join("");
  if (!text) throw withUsage(new GuteAyriError(`Gemini returned an empty answer (${cand.finishReason || "unknown"}).`, "empty"), usage);
  return { text, usage };
}

/* ---------- HTTP ---------- */

function networkError(p, url) {
  const scheme = new URL(browser.runtime.getURL("")).protocol; // moz-extension: or chrome-extension:
  const hint = p.id === "ollama" ? ` Start Ollama with OLLAMA_ORIGINS=${scheme}//* so the extension can reach it.`
    : p.id === "cliproxy" ? " Start CLIProxyAPI on this computer (it listens on port 8317 unless its config.yaml says otherwise)."
    : "";
  return new GuteAyriError(`Couldn't reach ${p.def.name} at ${new URL(url).host}.${hint}`, "network");
}

const timeoutError = (p) => new GuteAyriError(`${p.def.name} took longer than ${REQUEST_TIMEOUT_MS / 60000} minutes. Try a lower reasoning level.`, "timeout");

/* Starts a streamed request. The timeout covers the whole stream, so it stays armed until readEvents finishes. */
async function openStream(p, url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    res.guteayriTimer = timer;
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err.name === "AbortError" ? timeoutError(p) : networkError(p, url);
  }
}

/* Calls onEvent with each JSON event of a server-sent event stream. */
async function readEvents(p, res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (block) => {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    try { onEvent(JSON.parse(data)); } catch (e) { /* not JSON: skip */ }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        flush(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    flush(buf);
  } catch (err) {
    // An interrupted stream ends without its final event; the caller reports that.
    if (err.name === "AbortError") throw timeoutError(p);
  } finally {
    clearTimeout(res.guteayriTimer);
  }
}

async function postJson(p, url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (err) {
    if (err.name === "AbortError") throw timeoutError(p);
    throw networkError(p, url);
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = null; }
  if (!res.ok) throw httpError(p, res.status, data, raw);
  if (!data) throw new GuteAyriError(`${p.def.name} sent a response that isn't JSON.`, "bad-response", res.status);
  return data;
}

function httpError(p, status, data, raw) {
  const detail =
    (data && data.error && (data.error.message || data.error.msg || (typeof data.error === "string" ? data.error : ""))) ||
    (data && data.message) ||
    (data && typeof data.detail === "string" && data.detail) ||
    (data && Array.isArray(data) && data[0] && data[0].error && data[0].error.message) ||
    String(raw || "").slice(0, 300);
  if (/usage limit|spend(ing)? limit|credit balance|billing|quota/i.test(detail) && status !== 404) {
    return new GuteAyriError(`${p.def.name}: this key has reached its usage or spending limit. Check billing and limits in the provider's console. (${detail})`, "limit", status);
  }
  if (status === 429) return new GuteAyriError(`${p.def.name} is rate-limiting this key (429). Wait a moment, then run again.`, "rate", status);
  if (p.def.kind === "gemini" && /api key not valid|API_KEY_INVALID/i.test(detail)) {
    return new GuteAyriError(`${p.def.name} rejected the API key. Check it in Settings.`, "auth", status);
  }
  if (p.def.kind === "anthropic" && /workspace/i.test(detail) && (status === 400 || status === 401 || status === 403)) {
    return new GuteAyriError(
      p.workspaceId
        ? `Anthropic didn't accept the workspace ID "${p.workspaceId}". Check it under Settings → Workspaces in the Claude Console.`
        : "This Anthropic key belongs to your whole organization, so it needs a workspace. Add a Workspace ID below, or create a key inside a workspace in the Claude Console.",
      "workspace",
      status
    );
  }
  if (status === 401 || status === 403) return new GuteAyriError(`${p.def.name} rejected the API key (${status}). Check it in Settings.`, "auth", status);
  if (status === 404 || (status === 400 && /model[^.]*(not exist|not found|does not exist|unknown|invalid|not supported)|unknown model|invalid model|model_not_found/i.test(detail))) return new GuteAyriError(`${p.def.name} doesn't know the model "${p.model}" (${status}). Pick another in Settings.`, "model", status);
  return new GuteAyriError(`${p.def.name} returned ${status}: ${detail}`, "http", status);
}

/* ---------- Model lists ---------- */

/* Models that can't answer a chat request (speech, embeddings, image generation, moderation). */
const NOT_CHAT_MODEL = /embed|tts|whisper|dall-e|moderation|transcri|audio|realtime|gpt-image|imagen|davinci|babbage|ocr|sora|-search-|computer-use/i;

async function guteayriListModels(settings, providerId) {
  // OpenRouter lists its models without a key.
  const p = providerConfig(settings, providerId, { keyOptional: (providerId || settings.provider) === "openrouter" });
  let url, headers = {};
  if (p.def.kind === "anthropic") {
    url = `${p.baseUrl}/models?limit=1000`;
    headers = { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    if (p.workspaceId) headers["anthropic-workspace-id"] = p.workspaceId;
  } else if (p.def.kind === "chatgpt") {
    // The models this ChatGPT account may use, in the server's order.
    url = `${p.baseUrl}/models`;
    headers = { authorization: `Bearer ${await chatgptAccessToken()}` };
  } else if (p.def.kind === "gemini") {
    url = `${p.baseUrl}/models?pageSize=1000`;
    headers = { "x-goog-api-key": p.apiKey };
  } else {
    url = `${p.baseUrl}/models`;
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  }
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw networkError(p, url);
  }
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { /* handled below */ }
  if (!res.ok) throw httpError(p, res.status, data, raw);
  if (!data) throw new GuteAyriError(`${p.def.name} sent a model list that isn't JSON.`, "bad-response", res.status);

  let ids = [];
  if (p.def.kind === "gemini") {
    ids = (data.models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""));
  } else {
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    ids = list.filter((m) => !m.visibility || m.visibility === "list").map((m) => m.slug || m.id || m.name).filter(Boolean);
  }
  ids = ids.filter((id) => !NOT_CHAT_MODEL.test(id));
  // ChatGPT lists its models best first; the others come alphabetically.
  return p.def.kind === "chatgpt" ? [...new Set(ids)] : [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/* ---------- JSON extraction ---------- */

function guteayriExtractJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = t.slice(start, end + 1);
    try { return JSON.parse(slice); } catch (e) {
      // Trailing commas are the most common defect in hand-rolled JSON.
      try { return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1")); } catch (e2) { /* give up */ }
    }
  }
  throw new GuteAyriError("The model's answer wasn't valid JSON. Run again, or try a stronger model.", "bad-json");
}
