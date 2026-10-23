/* GuteAyri — toolbar popup. */
const $ = (id) => document.getElementById(id);
const make = (tag, props) => Object.assign(document.createElement(tag), props || {});
let settings = null;
let chatgptSignedIn = false;

async function save(patch) {
  settings = await guteayriSaveSettings(patch);
  refreshNotice();
}

function providerNeedsKey(id = settings.provider) {
  const def = GUTEAYRI_PROVIDERS[id];
  if (def.account) return !chatgptSignedIn;
  return def.needsKey && !settings.providers[id].apiKey;
}

function refreshNotice() {
  const n = $("notice");
  if (providerNeedsKey()) {
    const def = GUTEAYRI_PROVIDERS[settings.provider];
    const what = def.account ? `Sign in with ${def.name} to start. ` : `Add your ${def.name} API key to start. `;
    n.replaceChildren(what, Object.assign(document.createElement("button"), { textContent: "Open settings", onclick: openSettings }));
    n.hidden = false;
  } else {
    n.hidden = true;
  }
}

function openSettings() {
  browser.runtime.openOptionsPage();
  window.close();
}

function fillModels() {
  const cfg = settings.providers[settings.provider];
  const def = GUTEAYRI_PROVIDERS[settings.provider];
  $("model").value = cfg.model || def.defaultModel;
  $("model").placeholder = def.defaultModel || "model id";
  $("model-list").replaceChildren(...(cfg.models || []).map((m) => Object.assign(document.createElement("option"), { value: m })));
}

async function render() {
  settings = await guteayriLoadSettings();
  chatgptSignedIn = (await chatgptStatus()).signedIn;

  const sel = $("provider");
  sel.replaceChildren(
    ...Object.entries(GUTEAYRI_PROVIDERS).map(([id, def]) => {
      const label = !providerNeedsKey(id) ? def.name : def.account ? `${def.name} (not signed in)` : `${def.name} (no key)`;
      return Object.assign(document.createElement("option"), { value: id, textContent: label });
    })
  );
  sel.value = settings.provider;
  fillModels();

  $("reasoning").replaceChildren(
    ...GUTEAYRI_REASONING_LEVELS.map((lvl) => {
      const label = make("label", { className: "choice" });
      const input = make("input", { type: "radio", className: "sr", name: "reasoning", value: lvl.id, checked: settings.reasoning === lvl.id });
      const bubble = make("span", { className: "bubble" });
      bubble.setAttribute("aria-hidden", "true");
      label.append(input, bubble, make("span", { textContent: lvl.label }));
      input.addEventListener("change", () => save({ reasoning: lvl.id }));
      return label;
    })
  );

  for (const key of ["autoMode", "reviewFirst", "includeScreenshot"]) {
    $(key).checked = !!settings[key];
    $(key).onchange = (e) => save({ [key]: e.target.checked });
  }

  try {
    const cmds = await browser.commands.getAll();
    const fill = cmds.find((c) => c.name === "fill-page");
    // Firefox reports "Alt+Shift+G"; Chrome on a Mac reports "⌥⇧G".
    $("fill-key").textContent = fill && fill.shortcut ? fill.shortcut.replace(/\+/g, " + ") : "";
  } catch (e) { /* no shortcut shown */ }

  refreshNotice();
}

$("provider").addEventListener("change", (e) => {
  save({ provider: e.target.value }).then(fillModels);
});

$("model").addEventListener("change", (e) => {
  const providers = settings.providers;
  providers[settings.provider].model = e.target.value.trim();
  save({ providers });
});

$("open-settings").addEventListener("click", openSettings);

$("fill").addEventListener("click", async () => {
  if (providerNeedsKey()) return openSettings();
  const btn = $("fill");
  btn.disabled = true;
  btn.classList.add("working");
  const res = await browser.runtime.sendMessage({ type: "runActive" });
  if (res && res.ok) return window.close();
  if (res && res.restricted) return answerFromScreenshot(res.windowId);
  btn.disabled = false;
  btn.classList.remove("working");
  $("notice").textContent = (res && res.error) || "Couldn't start on this tab.";
  $("notice").hidden = false;
});

/* Pages extensions can't touch (PDF viewer, reader view, browser pages) get answered from a screenshot. */
async function answerFromScreenshot(windowId) {
  const box = $("results");
  const title = make("h2", { textContent: "Reading a screenshot" });
  const note = make("p", { textContent: "Firefox doesn't let extensions into this page, so GuteAyri is answering from what's on screen. Nothing will be filled in." });
  box.replaceChildren(title, note);
  box.hidden = false;
  const res = await browser.runtime.sendMessage({ type: "solveScreenshot", windowId });
  const btn = $("fill");
  btn.disabled = false;
  btn.classList.remove("working");
  if (!res || !res.ok) {
    title.textContent = "Couldn't answer this page";
    note.textContent = (res && res.error) || "No response.";
    return;
  }
  const { answers, model } = res.result;
  title.textContent = answers.length ? "Answers from the screenshot" : "No questions found on screen";
  note.textContent = model;
  const ol = make("ol");
  answers.forEach((a, i) => {
    const li = make("li");
    ol.append(li);
    li.append(
      make("span", { className: "n", textContent: i + 1 }),
      make("span", { className: "q", textContent: a.q }),
      make("span", { className: "a", textContent: a.answer })
    );
  });
  box.append(ol);
}

render();
