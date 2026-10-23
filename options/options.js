/* GuteAyri — settings page. Every change saves immediately. */
const $ = (id) => document.getElementById(id);
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
let settings = null;
let chatgpt = { signedIn: false }; // the ChatGPT sign-in, from chatgptStatus()

/* ---------- Saving ---------- */

let savedTimer = null;
async function save(patch) {
  settings = await guteayriSaveSettings(patch);
  const el = $("saved");
  el.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove("show"), 1100);
  updateHint();
  renderProviders();
  renderFallbacks();
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function el(tag, props, ...kids) {
  const n = Object.assign(document.createElement(tag), props || {});
  n.append(...kids.filter((k) => k != null));
  return n;
}

/* ---------- Hero: the name grid ---------- */

function renderNameGrid() {
  const grid = $("namegrid");
  const word = "GUTEAYRI";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  grid.replaceChildren(
    ...[...word].map((ch, col) =>
      el("div", { className: "ng-col" },
        el("div", { className: "ng-box", textContent: ch }),
        ...[...alphabet].map((a) => {
          const b = el("span", { className: "ng-b" + (a === ch ? " on" : "") }, el("span", { textContent: a }));
          if (a === ch) b.style.setProperty("--d", `${280 + col * 110}ms`);
          return b;
        })
      )
    )
  );
}

function renderSetup() {
  const def = GUTEAYRI_PROVIDERS[settings.provider];
  const cfg = settings.providers[settings.provider];
  const level = GUTEAYRI_REASONING_LEVELS.find((l) => l.id === settings.reasoning);
  const topicsOn = settings.contexts.filter((t) => t.enabled).length;
  const rows = [
    ["Provider", def.name, true],
    ["Model", cfg.model || def.defaultModel || "Not chosen", !!(cfg.model || def.defaultModel)],
    ["Reasoning", level ? level.label : settings.reasoning, true],
    ["Auto mode", settings.autoMode ? "On" : "Off", settings.autoMode],
    ["Topics", topicsOn ? `${topicsOn} sent with every page` : "None", topicsOn > 0],
    ["Fallbacks", fallbackIds().map((id) => GUTEAYRI_PROVIDERS[id].name).join(", ") || "None", fallbackIds().length > 0],
  ];
  $("setup").replaceChildren(...rows.flatMap(([k, v, on]) => [el("dt", { textContent: k }), el("dd", { textContent: v, title: v, className: on ? "" : "off" })]));
}

function updateHint() {
  renderSetup();
  const def = GUTEAYRI_PROVIDERS[settings.provider];
  const cfg = settings.providers[settings.provider];
  const hint = $("hero-hint");
  if (def.account && !chatgpt.signedIn) {
    hint.textContent = `Sign in with ${def.name} below to get started.`;
  } else if (def.needsKey && !cfg.apiKey) {
    hint.textContent = `Paste your ${def.name} API key below to get started.`;
  } else {
    browser.commands.getAll().then((cmds) => {
      const fill = cmds.find((c) => c.name === "fill-page");
      hint.textContent = fill && fill.shortcut
        ? `Ready. Press ${prettyShortcut(fill.shortcut)} on any page with questions.`
        : "Ready. Click the GuteAyri button on any page with questions.";
    });
  }
}

/* ---------- Provider ---------- */

/* Whether a provider has what it needs to send a request: a key, a sign-in, or an address. */
function providerReady(id) {
  const def = GUTEAYRI_PROVIDERS[id];
  const cfg = settings.providers[id];
  return def.account ? chatgpt.signedIn : def.needsKey ? !!cfg.apiKey : id !== "custom" || !!cfg.baseUrl;
}

function renderProviders() {
  const wrap = $("providers");
  wrap.replaceChildren(
    ...Object.entries(GUTEAYRI_PROVIDERS).map(([id, def]) => {
      const cfg = settings.providers[id];
      const ready = providerReady(id);
      const label = el("label", { className: "prov" });
      const input = el("input", { type: "radio", name: "provider", value: id, className: "sr", checked: settings.provider === id });
      input.addEventListener("change", async () => {
        await save({ provider: id });
        renderDetail();
        renderLevelNote();
      });
      label.append(
        ...[
          input,
          el("span", { className: "bubble" }),
          el("strong", { textContent: def.name }),
          el("small", { textContent: def.note }),
          ready && (def.account || def.needsKey || id === "custom") ? el("span", { className: "ready", textContent: def.account ? "Signed in" : def.needsKey ? "Key saved" : "Configured" }) : null,
        ].filter(Boolean)
      );
      return label;
    })
  );
}

function renderDetail() {
  const id = settings.provider;
  const def = GUTEAYRI_PROVIDERS[id];
  const cfg = settings.providers[id];

  // Signed-in providers have no key and a fixed address.
  $("account-row").hidden = !def.account;
  $("key-row").hidden = !!def.account;
  $("base-row").hidden = !!def.account;
  renderAccount();

  $("apiKey").value = cfg.apiKey || "";
  $("apiKey").placeholder = def.needsKey ? `Paste your ${def.name} key` : id === "cliproxy" ? "A key from api-keys in its config.yaml, if set" : "Optional for this provider";
  $("key-link").hidden = !def.keyUrl;
  if (def.keyUrl) $("key-link").href = def.keyUrl;
  $("key-link").textContent = def.keyLabel || "Get a key";

  $("model").value = cfg.model || "";
  $("model").placeholder = def.defaultModel || "model id";
  fillModelList(cfg.models || []);

  $("workspace-row").hidden = def.kind !== "anthropic";
  $("workspaceId").value = cfg.workspaceId || "";

  $("baseUrl").value = cfg.baseUrl || "";
  $("baseUrl").placeholder = def.baseUrl || "https://your-server/v1";
  $("base-note").textContent = id === "ollama" ? "Run Ollama with OLLAMA_ORIGINS=moz-extension://*"
    : id === "cliproxy" ? "Sign in to each service with CLIProxyAPI's -login options first"
    : id === "custom" ? "OpenAI-compatible" : "Leave empty for the default";

  $("test-result").textContent = "";
  $("test-result").className = "result";

  $("backup-row").hidden = !!def.account;
  renderBackupKeys();
  renderFallbacks();
}

/* ---------- Backup keys ---------- */

function renderBackupKeys() {
  const id = settings.provider;
  const keys = settings.providers[id].backupKeys || [];
  $("backup-keys").replaceChildren(...keys.map((key, i) => {
    const input = el("input", { type: "password", value: key, spellcheck: false, autocomplete: "off", placeholder: `Backup key ${i + 1}` });
    input.setAttribute("aria-label", `Backup key ${i + 1}`);
    input.addEventListener("input", () => saveBackupKeys(id));
    const show = el("button", { type: "button", className: "btn ghost small", textContent: "Show" });
    show.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      show.textContent = input.type === "password" ? "Show" : "Hide";
    });
    const remove = el("button", { type: "button", className: "btn ghost small", textContent: "Remove" });
    remove.addEventListener("click", async () => {
      const providers = settings.providers;
      providers[id].backupKeys = backupKeysInForm().filter((_, j) => j !== i);
      await save({ providers });
      renderBackupKeys();
    });
    return el("li", { className: "field" }, input, show, remove);
  }));
  $("add-key").textContent = keys.length ? "Add another backup key" : "Add a backup key";
}

function backupKeysInForm() {
  return [...$("backup-keys").querySelectorAll("input")].map((i) => i.value.trim());
}

// The provider is captured when typing, as with the main key.
const saveBackupKeys = debounce((provider) => {
  if (provider !== settings.provider) return;
  const providers = settings.providers;
  providers[provider].backupKeys = backupKeysInForm();
  save({ providers });
}, 350);

$("add-key").addEventListener("click", async () => {
  const providers = settings.providers;
  providers[settings.provider].backupKeys = [...backupKeysInForm(), ""];
  await save({ providers });
  renderBackupKeys();
  const inputs = $("backup-keys").querySelectorAll("input");
  if (inputs.length) inputs[inputs.length - 1].focus();
});

/* ---------- Fallback providers ---------- */

/* The fallbacks in order, leaving out the chosen provider itself. */
function fallbackIds() {
  return (settings.fallbacks || []).filter((id) => id !== settings.provider && GUTEAYRI_PROVIDERS[id]);
}

function renderFallbacks() {
  const main = GUTEAYRI_PROVIDERS[settings.provider];
  $("fallback-main").textContent = main.name;
  const ids = fallbackIds();
  const move = async (from, to) => {
    const list = fallbackIds();
    const [id] = list.splice(from, 1);
    list.splice(to, 0, id);
    await save({ fallbacks: list });
  };
  $("fallbacks").replaceChildren(...(ids.length ? ids.map((id, i) => {
    const def = GUTEAYRI_PROVIDERS[id];
    const cfg = settings.providers[id];
    const ready = providerReady(id);
    const keys = [cfg.apiKey, ...(cfg.backupKeys || [])].filter((k) => String(k || "").trim()).length;
    const what = !ready ? (def.account ? "Not signed in: skipped" : "Not set up: skipped")
      : [cfg.model || def.defaultModel || "no model chosen", keys > 1 ? `${keys} keys` : ""].filter(Boolean).join(" · ");
    const up = el("button", { type: "button", className: "btn ghost small", textContent: "Up", disabled: i === 0 });
    up.addEventListener("click", () => move(i, i - 1));
    const down = el("button", { type: "button", className: "btn ghost small", textContent: "Down", disabled: i === ids.length - 1 });
    down.addEventListener("click", () => move(i, i + 1));
    const remove = el("button", { type: "button", className: "btn ghost small", textContent: "Remove" });
    remove.addEventListener("click", () => save({ fallbacks: fallbackIds().filter((x) => x !== id) }));
    return el("li", { className: "fb" + (ready ? "" : " off") },
      el("span", { className: "fb-n", textContent: String(i + 1) }),
      el("span", { className: "fb-name" }, el("strong", { textContent: def.name }), el("small", { textContent: what })),
      el("span", { className: "fb-tools" }, up, down, remove));
  }) : [el("li", { className: "fb-empty", textContent: "No fallbacks yet. If the provider fails, the run stops with its error." })]));

  const others = Object.keys(GUTEAYRI_PROVIDERS).filter((id) => id !== settings.provider && !ids.includes(id));
  $("fallback-add").replaceChildren(
    el("option", { value: "", textContent: others.length ? "Add a fallback provider…" : "Every provider is already a fallback" }),
    ...others.map((id) => el("option", { value: id, textContent: GUTEAYRI_PROVIDERS[id].name + (providerReady(id) ? "" : " (not set up yet)") }))
  );
  $("fallback-add").disabled = !others.length;
}

$("fallback-add").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (!id) return;
  await save({ fallbacks: [...fallbackIds(), id] });
});

/* ---------- Log ---------- */

const LOG_WHAT = { page: "Page", question: "Question", test: "Test" };
const LOG_REASON = { auth: "Key rejected", limit: "Out of credit", rate: "Rate-limited", workspace: "Workspace", network: "Unreachable", timeout: "Timed out",
  model: "Unknown model", "no-key": "No key", config: "Not set up", refusal: "Declined", "bad-json": "Unreadable answer", empty: "Empty answer", truncated: "Cut off", incomplete: "Cut off" };

function keyLabel(row) {
  if (!row.keyNo) return "";
  const n = row.keyNo === 1 ? "main key" : `backup key ${row.keyNo - 1}`;
  return row.keyHint ? `${n} ${row.keyHint}` : n;
}

async function renderLog() {
  const rows = (await browser.storage.local.get("requestLog")).requestLog || [];
  const shown = $("log-failed").checked ? rows.filter((r) => !r.ok) : rows;
  const failed = rows.filter((r) => !r.ok).length;
  $("log-count").textContent = rows.length ? `${rows.length} requests, ${failed} failed` : "";
  const today = new Date().toDateString();
  const when = (t) => {
    const d = new Date(t);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return d.toDateString() === today ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  };
  const tbody = $("log").tBodies[0];
  if (!shown.length) {
    tbody.replaceChildren(el("tr", { className: "empty" }, el("td", { colSpan: 5, textContent: rows.length ? "No failed requests." : "Nothing yet. Requests appear here as GuteAyri sends them." })));
    return;
  }
  tbody.replaceChildren(...shown.slice(0, 200).map((r) => {
    const def = GUTEAYRI_PROVIDERS[r.provider];
    const secs = r.ms != null ? `${(r.ms / 1000).toFixed(1)} s` : "";
    const result = r.ok
      ? el("td", { className: "ok", textContent: ["OK", secs, r.usage ? `${r.usage.input.toLocaleString()} in · ${r.usage.output.toLocaleString()} out` : ""].filter(Boolean).join(" · ") })
      : el("td", { className: "bad", title: r.error || "" },
          el("strong", { textContent: (LOG_REASON[r.code] || "Failed") + (r.status ? ` (${r.status})` : "") }),
          el("span", { textContent: r.error ? ` ${r.error}` : "" }));
    return el("tr", { className: r.ok ? "" : "failed" },
      el("td", { className: "t", textContent: when(r.t) }),
      el("td", { textContent: LOG_WHAT[r.what] || r.what || "" }),
      el("td", {}, el("span", { textContent: def ? def.name : r.provider }), el("small", { textContent: keyLabel(r) })),
      el("td", { className: "m", textContent: r.model || "" }),
      result);
  }));
}

$("log-failed").addEventListener("change", renderLog);
$("clear-log").addEventListener("click", async () => {
  await browser.storage.local.remove("requestLog");
  renderLog();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.requestLog) renderLog();
});

/* ---------- ChatGPT sign-in ---------- */

function renderAccount() {
  const def = GUTEAYRI_PROVIDERS[settings.provider];
  if (!def.account) return;
  const state = $("account-state");
  const signIn = $("sign-in");
  $("usage-link").href = CHATGPT_AUTH.usageUrl;
  if (chatgpt.signedIn && chatgpt.planOn) {
    state.textContent = `Signed in as ${chatgpt.email || "your ChatGPT account"}. Requests use your ChatGPT plan.`;
    signIn.hidden = true;
  } else if (chatgpt.signedIn) {
    state.textContent = `Signed in as ${chatgpt.email || "your ChatGPT account"}, but using your plan in GuteAyri wasn't allowed.`;
    signIn.hidden = false;
    signIn.textContent = "Allow plan use";
  } else {
    state.textContent = chatgpt.lastEmail ? `Signed out. Last used: ${chatgpt.lastEmail}.` : "Not signed in. Works with ChatGPT Plus, Pro and other plans that allow use in other apps.";
    signIn.hidden = false;
    signIn.textContent = "Continue with ChatGPT";
  }
  state.classList.toggle("off", !chatgpt.signedIn);
  $("sign-in-other").hidden = !chatgpt.signedIn && !chatgpt.lastEmail;
  $("sign-out").hidden = !chatgpt.signedIn;
}

async function refreshAccount() {
  chatgpt = await chatgptStatus();
  renderAccount();
  renderProviders();
  updateHint();
}

async function runSignIn(opts) {
  const buttons = ["sign-in", "sign-in-other", "sign-out"].map($);
  buttons.forEach((b) => (b.disabled = true));
  showTest("Finish signing in on the ChatGPT tab…", true);
  $("test-result").className = "result";
  try {
    const status = await chatgptSignIn(opts);
    showTest(status.planOn ? `Signed in as ${status.email}.` : "Signed in, but plan use wasn't allowed. Press Allow plan use to choose again.", status.planOn);
  } catch (e) {
    showTest(e.message, false);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    // The sign-in tab closes on its own; bring this page back to the front.
    browser.tabs.getCurrent().then((t) => t && browser.tabs.update(t.id, { active: true })).catch(() => {});
    await refreshAccount();
  }
}

$("sign-in").addEventListener("click", () => runSignIn({ consent: chatgpt.signedIn && !chatgpt.planOn }));
$("sign-in-other").addEventListener("click", () => runSignIn({ fresh: true }));
$("sign-out").addEventListener("click", async () => {
  const { revoked } = await chatgptSignOut();
  showTest(revoked ? "Signed out." : "Signed out here, but ChatGPT couldn't be told. You can disconnect GuteAyri in ChatGPT's settings.", revoked);
  await refreshAccount();
});

// The background page signs out by itself when a sign-in can no longer be renewed.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[CHATGPT_STORE]) refreshAccount();
});

function fillModelList(models) {
  $("model-list").replaceChildren(...models.map((m) => el("option", { value: m })));
  $("model-count").textContent = models.length ? `${models.length} models loaded` : "";
}

// The provider is captured when typing, so switching provider within the delay can't move a key to the wrong one.
const saveProviderField = debounce((provider, field, value) => {
  const providers = settings.providers;
  providers[provider][field] = value.trim();
  save({ providers });
}, 350);

for (const field of ["apiKey", "model", "baseUrl", "workspaceId"]) {
  $(field).addEventListener("input", (e) => saveProviderField(settings.provider, field, e.target.value));
}

$("toggle-key").addEventListener("click", () => {
  const input = $("apiKey");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("toggle-key").textContent = show ? "Hide" : "Show";
});

$("load-models").addEventListener("click", async () => {
  const btn = $("load-models");
  btn.disabled = true;
  $("model-count").textContent = "Loading…";
  const id = settings.provider;
  const res = await browser.runtime.sendMessage({
    type: "listModels",
    provider: id,
    draft: { apiKey: $("apiKey").value.trim(), baseUrl: $("baseUrl").value.trim(), workspaceId: $("workspaceId").value.trim() },
  });
  btn.disabled = false;
  if (!res.ok) {
    $("model-count").textContent = "";
    showTest(res.error, false);
    return;
  }
  const providers = settings.providers;
  providers[id].models = res.models;
  await save({ providers });
  fillModelList(res.models);
  $("model").focus();
});

function showTest(text, ok) {
  const r = $("test-result");
  r.textContent = text;
  r.className = "result " + (ok ? "ok" : "bad");
}

$("test").addEventListener("click", async () => {
  const btn = $("test");
  btn.disabled = true;
  showTest("Sending a test request…", true);
  $("test-result").className = "result";
  const providers = settings.providers;
  Object.assign(providers[settings.provider], {
    apiKey: $("apiKey").value.trim(),
    backupKeys: GUTEAYRI_PROVIDERS[settings.provider].account ? providers[settings.provider].backupKeys : backupKeysInForm(),
    model: $("model").value.trim(),
    baseUrl: $("baseUrl").value.trim(),
    workspaceId: $("workspaceId").value.trim(),
  });
  await save({ providers });
  const res = await browser.runtime.sendMessage({ type: "testConnection" });
  btn.disabled = false;
  const results = res.results || [];
  if (results.length <= 1) {
    const r = results[0];
    showTest(r && r.ok ? `Connected. ${r.model} is answering.` : (r && r.error) || res.error || "No answer.", !!(r && r.ok));
    return;
  }
  // Several keys: one short verdict per key; the log has the full errors.
  const name = (n) => (n === 1 ? "Main key" : `Backup key ${n - 1}`);
  const VERDICT = { auth: "rejected", limit: "out of credit", rate: "rate-limited", workspace: "needs a workspace", network: "unreachable", timeout: "timed out", model: "doesn't know this model" };
  const verdicts = results.map((r) => `${name(r.keyNo)} ${r.ok ? "works" : VERDICT[r.code] || "failed"}`);
  showTest(`${verdicts.join(" · ")}.${results.some((r) => !r.ok) ? " Details in the log below." : ""}`, res.ok);
});

/* ---------- Reasoning ---------- */

const LEVEL_NOTES = {
  openai: "Sent as reasoning effort. Off asks for no reasoning where the model allows it, and Max for the highest effort it supports.",
  cliproxy: "Sent as reasoning effort, which CLIProxyAPI translates for the service behind each model. Off leaves the model's default.",
  xai: "Sent as reasoning effort to Grok models that accept it; older Grok models ignore the level.",
  openrouter: "Sent to OpenRouter as reasoning effort, which it translates for each model. Off turns reasoning off.",
  anthropic: "Sent as adaptive thinking with an effort level. Off answers at the lowest effort without thinking.",
  gemini: "Sent as a thinking budget on Gemini 2.5 and a thinking level on newer models.",
  deepseek: "Off turns thinking off; the other levels set DeepSeek's reasoning effort.",
  none: "This provider has no reasoning setting, so the level is ignored.",
};

function renderLevels() {
  const wrap = $("levels");
  wrap.replaceChildren(
    ...GUTEAYRI_REASONING_LEVELS.map((lvl) => {
      const input = el("input", { type: "radio", name: "reasoning", value: lvl.id, className: "sr", checked: settings.reasoning === lvl.id });
      input.addEventListener("change", () => save({ reasoning: lvl.id }));
      return el("label", { className: "level" }, input, el("span", { className: "bubble" }), el("span", { textContent: lvl.label }));
    })
  );
  const note = el("p", { className: "level-note", id: "level-note" });
  wrap.after(note);
  renderLevelNote();
}

function renderLevelNote() {
  const def = GUTEAYRI_PROVIDERS[settings.provider];
  const n = $("level-note");
  if (n) n.textContent = `${def.name}: ${LEVEL_NOTES[settings.provider] || LEVEL_NOTES[def.reasoning] || LEVEL_NOTES.openai}`;
}

/* ---------- Instructions ---------- */

function renderPrompt() {
  $("systemPrompt").value = settings.systemPrompt;
  countPrompt();
}
function countPrompt() {
  $("prompt-count").textContent = `${$("systemPrompt").value.length.toLocaleString()} characters`;
}
$("systemPrompt").addEventListener("input", (e) => {
  countPrompt();
  savePrompt(e.target.value);
});
const savePrompt = debounce((v) => save({ systemPrompt: v }), 400);
$("reset-prompt").addEventListener("click", () => {
  $("systemPrompt").value = GUTEAYRI_DEFAULT_PROMPT;
  countPrompt();
  save({ systemPrompt: GUTEAYRI_DEFAULT_PROMPT });
});

/* ---------- Knowledge ---------- */

const saveTopics = debounce(() => save({ contexts: settings.contexts }), 400);

function renderTopics() {
  const list = $("topics");
  const topics = settings.contexts;
  if (!topics.length) {
    list.replaceChildren(el("p", { className: "topics-empty", textContent: "No topics yet. Add one for each subject you want the model to know about." }));
  } else {
    list.replaceChildren(...topics.map(topicRow));
  }
  renderTopicsCount();
}

/* save() replaces `settings`, so look the topic up each time instead of keeping the object a row was built with. */
function liveTopic(t) {
  return settings.contexts.find((x) => x.id === t.id) || t;
}

function topicRow(t) {
  const li = el("li", { className: "topic" + (t.enabled ? "" : " off") });
  const toggle = el("label", { title: t.enabled ? "On: sent with every page" : "Off: not sent" });
  const cb = el("input", { type: "checkbox", className: "sr", checked: !!t.enabled });
  cb.setAttribute("aria-label", `Send “${t.title || "Untitled"}” with every page`);
  cb.addEventListener("change", () => {
    liveTopic(t).enabled = cb.checked;
    li.classList.toggle("off", !cb.checked);
    saveTopics();
    renderTopicsCount();
  });
  toggle.append(cb, el("span", { className: "bubble" }));

  const title = el("input", { className: "title", value: t.title || "", placeholder: "Topic, e.g. Organic chemistry" });
  title.addEventListener("input", () => { liveTopic(t).title = title.value; saveTopics(); });

  const del = el("button", { className: "btn ghost small", type: "button", textContent: "Delete" });
  del.addEventListener("click", () => {
    settings.contexts = settings.contexts.filter((x) => x.id !== t.id);
    save({ contexts: settings.contexts });
    renderTopics();
  });

  const body = el("textarea", { value: t.body || "", rows: 6, placeholder: "Facts, definitions, formulas, or pasted course notes." });
  body.addEventListener("input", () => { liveTopic(t).body = body.value; saveTopics(); renderTopicsCount(); });

  li.append(toggle, title, el("div", { className: "tools" }, del), body);
  return li;
}

function renderTopicsCount() {
  const topics = settings.contexts;
  const on = topics.filter((t) => t.enabled);
  const chars = on.reduce((n, t) => n + (t.body || "").length, 0);
  $("topics-count").textContent = topics.length ? `${on.length} of ${topics.length} on, ${chars.toLocaleString()} characters sent` : "";
}

function newTopic(title = "", body = "") {
  return { id: Math.random().toString(36).slice(2, 10), title, body, enabled: true };
}

$("add-topic").addEventListener("click", async () => {
  settings.contexts.push(newTopic());
  await save({ contexts: settings.contexts });
  renderTopics();
  const titles = document.querySelectorAll(".topic input.title");
  if (titles.length) titles[titles.length - 1].focus();
});

$("import-file").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    const text = await file.text();
    settings.contexts.push(newTopic(file.name.replace(/\.[^.]+$/, ""), text));
  }
  e.target.value = "";
  await save({ contexts: settings.contexts });
  renderTopics();
});

/* ---------- Shortcuts ---------- */

const KEY_NAMES = {
  Comma: "Comma", Period: "Period", Space: "Space", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  Insert: "Insert", Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
};

function keyFromEvent(e) {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(c)) return c;
  return KEY_NAMES[c] || null;
}

function shortcutFromEvent(e) {
  const mods = [];
  if (isMac) {
    if (e.metaKey) mods.push("Command");
    if (e.altKey) mods.push("Alt");
    if (e.ctrlKey) mods.push("MacCtrl");
  } else {
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
  }
  if (e.shiftKey) mods.push("Shift");
  return { mods, key: keyFromEvent(e) };
}

function prettyPart(p) {
  if (isMac) return { Command: "⌘", Alt: "⌥", MacCtrl: "⌃", Ctrl: "⌘", Shift: "⇧" }[p] || p;
  return p;
}

/* Shortcut parts. Firefox reports "Alt+Shift+G"; Chrome on a Mac reports "⌥⇧G". */
function shortcutParts(s) {
  if (s.includes("+")) return s.split("+");
  const m = s.match(/^([⌃⌥⇧⌘]*)(.+)$/);
  return m ? [...m[1], m[2]] : [s];
}

function prettyShortcut(s) {
  return shortcutParts(s).map(prettyPart).join(isMac ? "" : "+");
}

function keyChips(s) {
  return shortcutParts(s).map((p) => el("kbd", { textContent: prettyPart(p) }));
}

// Firefox lets extensions change their shortcuts; Chrome keeps them on its own page.
const canEditKeys = typeof browser.commands.update === "function";

async function renderKeys() {
  const cmds = await browser.commands.getAll();
  const order = ["fill-page", "answer-selection", "toggle-panel", "fill-reviewed", "undo-fills", "toggle-auto", "_execute_browser_action", "_execute_action"];
  cmds.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  if (!canEditKeys) {
    const rows = cmds.map((c) => readOnlyKeyRow(c));
    if (browser.runtime.getURL("").startsWith("safari-web-extension:")) {
      $("keys-sub").textContent = "Safari doesn't let extensions change their shortcuts, so these are fixed. The toolbar button and the right-click menu work too.";
      $("keys").replaceChildren(...rows);
      return;
    }
    $("keys-sub").textContent = "Chrome keeps extension shortcuts on its own page. Set or change them there; they show up here.";
    const open = el("button", { type: "button", className: "btn", textContent: "Change shortcuts in Chrome" });
    open.addEventListener("click", () => browser.tabs.create({ url: "chrome://extensions/shortcuts" }));
    $("keys").replaceChildren(...rows, el("li", { className: "key-open" }, open));
    return;
  }
  $("keys").replaceChildren(...cmds.map((c) => keyRow(c, cmds)));
}

function readOnlyKeyRow(cmd) {
  const label = cmd.description || (cmd.name === "_execute_action" ? "Open the GuteAyri popup" : cmd.name);
  const keys = el("span", { className: "recorder static" + (cmd.shortcut ? "" : " empty") }, ...(cmd.shortcut ? keyChips(cmd.shortcut) : [document.createTextNode("Not set")]));
  return el("li", { className: "key-row" }, el("span", { className: "key-name", textContent: label }), keys);
}

function keyRow(cmd, all) {
  const li = el("li", { className: "key-row" });
  const name = el("span", { className: "key-name", textContent: cmd.description || cmd.name });
  const rec = el("button", { type: "button", className: "recorder" + (cmd.shortcut ? "" : " empty") });
  const paint = (s) => {
    rec.replaceChildren(...(s ? keyChips(s) : [document.createTextNode("Not set")]));
    rec.classList.toggle("empty", !s);
  };
  paint(cmd.shortcut);
  rec.setAttribute("aria-label", `Shortcut for ${cmd.description}: ${cmd.shortcut || "not set"}. Press to change.`);

  let err = null;
  const showError = (msg) => {
    if (err) err.remove();
    err = msg ? el("p", { className: "key-error", textContent: msg }) : null;
    if (err) li.append(err);
  };

  let listening = false;
  const stop = () => {
    listening = false;
    rec.classList.remove("listening");
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("keyup", onKeyUp, true);
  };
  const onKeyUp = (e) => {
    if (!listening) return;
    const { mods, key } = shortcutFromEvent(e);
    if (!key && !mods.length) rec.replaceChildren(document.createTextNode("Press keys…"));
  };
  const onKey = async (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stop();
      paint(cmd.shortcut);
      showError(null);
      return;
    }
    const { mods, key } = shortcutFromEvent(e);
    if (!key) {
      rec.replaceChildren(...(mods.length ? mods.map((m) => el("kbd", { textContent: prettyPart(m) })) : [document.createTextNode("Press keys…")]));
      return;
    }
    const primary = mods.some((m) => m !== "Shift");
    if (!primary && !/^F\d+$/.test(key)) {
      showError(isMac ? "Add ⌘, ⌥ or ⌃ to that key." : "Add Ctrl or Alt to that key.");
      return;
    }
    const shortcut = [...mods, key].join("+");
    const clash = all.find((c) => c.name !== cmd.name && c.shortcut === shortcut);
    if (clash) {
      showError(`That's already used for “${clash.description}”.`);
      return;
    }
    stop();
    try {
      await browser.commands.update({ name: cmd.name, shortcut });
      cmd.shortcut = shortcut;
      paint(shortcut);
      showError(null);
      flashSaved();
      updateHint();
    } catch (ex) {
      paint(cmd.shortcut);
      showError(`The browser didn't accept ${prettyShortcut(shortcut)}: ${ex.message}`);
    }
  };

  rec.addEventListener("click", () => {
    if (listening) return;
    listening = true;
    rec.classList.add("listening");
    rec.replaceChildren(document.createTextNode("Press keys…"));
    showError(null);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
  });
  rec.addEventListener("blur", () => {
    if (listening) {
      stop();
      paint(cmd.shortcut);
    }
  });

  const clear = el("button", { type: "button", className: "btn ghost small", textContent: "Clear" });
  clear.addEventListener("click", async () => {
    try {
      await browser.commands.update({ name: cmd.name, shortcut: "" });
      cmd.shortcut = "";
      paint("");
      showError(null);
      flashSaved();
      updateHint();
    } catch (ex) {
      showError(ex.message);
    }
  });
  const reset = el("button", { type: "button", className: "btn ghost small", textContent: "Default" });
  reset.addEventListener("click", async () => {
    await browser.commands.reset(cmd.name);
    const fresh = (await browser.commands.getAll()).find((c) => c.name === cmd.name);
    cmd.shortcut = (fresh && fresh.shortcut) || "";
    paint(cmd.shortcut);
    showError(null);
    flashSaved();
    updateHint();
  });

  li.append(name, rec, el("div", { className: "key-tools" }, clear, reset));
  return li;
}

function flashSaved() {
  const s = $("saved");
  s.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove("show"), 1100);
}

/* ---------- Behavior ---------- */

function renderBehavior() {
  for (const key of ["autoMode", "reviewFirst", "showPanel", "includeScreenshot", "clickButtons", "fillPersonal"]) {
    $(key).checked = !!settings[key];
    $(key).onchange = (e) => {
      save({ [key]: e.target.checked });
      if (key === "autoMode") $("sites-wrap").hidden = !e.target.checked;
    };
  }
  $("sites-wrap").hidden = !settings.autoMode;
  $("autoSites").value = settings.autoSites || "";
  $("autoSites").addEventListener("input", debounce((e) => save({ autoSites: e.target.value }), 400));
  $("maxImages").value = settings.maxImages;
  $("maxChars").value = settings.maxChars;
  $("maxImages").addEventListener("change", (e) => save({ maxImages: Math.max(0, Math.min(40, parseInt(e.target.value, 10) || 0)) }));
  $("maxChars").addEventListener("change", (e) => save({ maxChars: Math.max(5000, Math.min(400000, parseInt(e.target.value, 10) || 60000)) }));
}

/* ---------- Start ---------- */

(async function init() {
  settings = await guteayriLoadSettings();
  chatgpt = await chatgptStatus();
  renderNameGrid();
  renderProviders();
  renderDetail();
  renderLevels();
  renderPrompt();
  renderTopics();
  renderBehavior();
  renderLog();
  await renderKeys();
  updateHint();
})();
