/* GuteAyri — shared settings, provider catalogue and defaults.
   Loaded by the background page, popup, options page and content scripts. */

var GUTEAYRI_PROVIDERS = {
  openai: {
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    needsKey: true,
    vision: true,
    reasoning: "openai",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "GPT-5, o-series, GPT-4.1",
  },
  chatgpt: {
    name: "ChatGPT",
    kind: "chatgpt",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-6.1-sol",
    needsKey: false,
    account: true,           // signs in with ChatGPT instead of taking a key
    vision: true,
    reasoning: "openai",
    keyUrl: "",
    note: "Your ChatGPT plan, no API key",
  },
  anthropic: {
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-opus-5-5",
    needsKey: true,
    vision: true,
    reasoning: "anthropic",
    keyUrl: "https://platform.claude.com/settings/keys",
    note: "Claude Opus, Sonnet, Haiku",
  },
  gemini: {
    name: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.8-flash",
    needsKey: true,
    vision: true,
    reasoning: "gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Gemini Pro and Flash",
  },
  openrouter: {
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5",
    needsKey: true,
    vision: true,
    reasoning: "openrouter",
    keyUrl: "https://openrouter.ai/keys",
    note: "Hundreds of models, one key",
  },
  xai: {
    name: "xAI",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    needsKey: true,
    vision: true,
    reasoning: "xai",
    keyUrl: "https://console.x.ai",
    note: "Grok",
  },
  groq: {
    name: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    needsKey: true,
    vision: true,
    maxImages: 5,            // Groq accepts at most 5 images per request
    reasoning: "openai",
    keyUrl: "https://console.groq.com/keys",
    note: "Very fast open models",
  },
  mistral: {
    name: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    needsKey: true,
    vision: true,
    reasoning: "none",
    keyUrl: "https://console.mistral.ai/api-keys",
    note: "Mistral Large, Pixtral",
  },
  deepseek: {
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-flash",
    needsKey: true,
    vision: true,
    reasoning: "deepseek",
    keyUrl: "https://platform.deepseek.com/api_keys",
    note: "DeepSeek Flash and Pro",
  },
  ollama: {
    name: "Ollama",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5vl",
    needsKey: false,
    vision: true,
    reasoning: "none",
    keyUrl: "",
    note: "Local models on this computer",
  },
  cliproxy: {
    name: "CLIProxyAPI",
    kind: "openai",
    baseUrl: "http://localhost:8317/v1",
    defaultModel: "",
    needsKey: false,
    vision: true,
    reasoning: "openai",
    keyUrl: "https://github.com/router-for-me/CLIProxyAPI",
    keyLabel: "Set it up",
    note: "Gemini, Codex, Qwen and other sign-ins, through a local proxy",
  },
  custom: {
    name: "Custom",
    kind: "openai",
    baseUrl: "",
    defaultModel: "",
    needsKey: false,
    vision: true,
    reasoning: "openai",
    keyUrl: "",
    note: "Any OpenAI-compatible endpoint",
  },
};

var GUTEAYRI_REASONING_LEVELS = [
  { id: "off", label: "Off" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
];

var GUTEAYRI_DEFAULT_PROMPT = `You are completing the questions on a web page for the person using this browser.

Read every question carefully, including images, tables, code and formulas. Work out the correct answer before committing to it. When a question is ambiguous, pick the answer a teacher marking against the course material would accept.

Write free-text answers in the same language as the question. Match the length the question asks for: a word or number for a blank, a sentence or two for a short answer, full paragraphs for an essay prompt.`;

var GUTEAYRI_DEFAULTS = {
  provider: "openai",
  providers: {},            // { [providerId]: { apiKey, backupKeys: [], model, baseUrl, models: [] } }
  fallbacks: [],            // provider ids to try, in order, when the chosen provider fails
  reasoning: "medium",
  systemPrompt: GUTEAYRI_DEFAULT_PROMPT,
  contexts: [],             // [{ id, title, body, enabled }]
  autoMode: false,
  autoSites: "",            // one pattern per line; empty = every site
  reviewFirst: false,
  showPanel: true,          // false: fill without opening the answer panel
  includeScreenshot: false,
  clickButtons: true,
  fillPersonal: false,
  maxImages: 12,
  maxChars: 60000,
};

async function guteayriLoadSettings() {
  const stored = await browser.storage.local.get("settings");
  const s = Object.assign({}, GUTEAYRI_DEFAULTS, stored.settings || {});
  s.providers = Object.assign({}, s.providers || {});
  for (const id of Object.keys(GUTEAYRI_PROVIDERS)) {
    s.providers[id] = Object.assign({ apiKey: "", backupKeys: [], model: "", baseUrl: "", workspaceId: "", models: [] }, s.providers[id] || {});
    if (!Array.isArray(s.providers[id].backupKeys)) s.providers[id].backupKeys = [];
  }
  s.fallbacks = (Array.isArray(s.fallbacks) ? s.fallbacks : []).filter((id) => GUTEAYRI_PROVIDERS[id]);
  if (!Array.isArray(s.contexts)) s.contexts = [];
  return s;
}

async function guteayriSaveSettings(patch) {
  const current = await guteayriLoadSettings();
  const next = Object.assign(current, patch);
  await browser.storage.local.set({ settings: next });
  return next;
}

function guteayriActiveModel(s) {
  const def = GUTEAYRI_PROVIDERS[s.provider] || GUTEAYRI_PROVIDERS.openai;
  const cfg = (s.providers && s.providers[s.provider]) || {};
  return cfg.model || def.defaultModel || "";
}

/* Matches a URL against the user's site list. Patterns: "example.com",
   "*.school.edu", "https://lms.example.com/quiz/*". */
function guteayriSiteAllowed(list, url) {
  const lines = String(list || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  let host = "";
  try { host = new URL(url).hostname; } catch (e) { return false; }
  return lines.some((p) => {
    if (/^[a-z]+:\/\//i.test(p)) {
      const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
      return re.test(url);
    }
    if (p.startsWith("*.")) return host === p.slice(2) || host.endsWith(p.slice(1));
    return host === p || host.endsWith("." + p);
  });
}
