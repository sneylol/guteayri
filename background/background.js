/* GuteAyri — background page: builds prompts, talks to providers, relays between frames. */

const MV3 = browser.runtime.getManifest().manifest_version === 3;
// Firefox's background page has a DOM; Chrome's service worker doesn't.
const HAS_DOM = typeof document !== "undefined";

const PROTOCOL = `## How the page is given to you
The page arrives as plain text in reading order. Interactive fields sit inline as markers in double braces:
  {{#12 radio g3 "Paris"}}        one option of radio group g3: choose exactly one per group
  {{#13 checkbox g4 "Option"}}    a checkbox: any number in a question may be correct
  {{#14 text "Label"}}            single-line text (also email, number, date, time, url, tel, range, color)
  {{#15 textarea}}                multi-line text
  {{#16 editor}}                  rich-text editor
  {{#17 select options=["A","B"] selected="A"}}   a dropdown; options=same means the same options as the select before it
  {{#18 combobox "Label"}}        a searchable dropdown
  {{#19 choice g5 "Option"}}      a clickable answer option in a custom widget; its text is in the quotes, or follows the marker
  {{#20 button}}                  a clickable button; its text follows the marker
"checked", "selected" or value="..." show what a field currently holds.
Images appear as {{IMG 3}}; the matching picture is attached and labelled "Image 3". Formulas appear as TeX between $ signs.

## What to return
Return a single JSON object and nothing else, on one line without indentation:
{"answers":[{"q":"...","fills":[{"id":12,"value":true}],"confidence":0.9}]}

- One entry per question, in page order.
- "q": the question, shortened to at most 8 words. Leave it out ("") when the question has a "### Question N" heading and you fill one of its fields; GuteAyri shows the page's own text then.
- "answer": only when "fills" is empty: the answer in a few words, so the person can read it.
- "fills": the field changes that enter this answer.
  - radio and choice: {"id":N,"value":true} for the correct option only.
  - checkbox: true for each box that should be ticked; false only for a box that is ticked now but shouldn't be. Boxes you leave out stay as they are.
  - text, textarea, editor: the exact text to enter. Dates as YYYY-MM-DD, times as HH:MM, numbers as plain digits.
  - select and combobox: the exact option text.
  - button: {"id":N,"value":true} only when the button is itself an answer option. Never press submit, next, finish, save, or navigation buttons.
- Matching and ordering questions usually show one select per item: give each select its own fill. Cloze questions with several blanks: fill every blank.
- Drag-and-drop blanks, drop zones and ordering positions are given as selects: answer each with the exact option text. A marker field takes "x,y" read off the coordinate grid drawn on its image ("x,y;x,y" for several copies).
- A question with nothing to fill (a drag-and-drop or hotspot with no field, an answer written elsewhere) still gets an entry with "fills": [] so the person can read the answer.
- Leave out fields that aren't questions: search boxes, logins, newsletter sign-ups, comments.
- Leave out fields that already hold the correct answer.
- "img": the numbers of the attached images the question shows, e.g. [1]. Leave it out for questions without one.
- "confidence": your probability, 0 to 1, that the answer is right.`;

function knowledgeBlock(s) {
  const notes = (s.contexts || []).filter((c) => c.enabled && String(c.body || "").trim());
  if (!notes.length) return "";
  const body = notes
    .map((c) => `<note title="${String(c.title || "Untitled").replace(/"/g, "'")}">\n${String(c.body).trim()}\n</note>`)
    .join("\n\n");
  return `\n\n## Reference notes from the person\nUse these whenever they're relevant. Where they disagree with general knowledge, follow the notes.\n\n${body}`;
}

function personalRule(s) {
  return s.fillPersonal
    ? "\n- Personal fields (name, email, student ID): fill them only with values from the reference notes."
    : "\n- Don't fill personal fields such as name, email or student ID.";
}

function solveSystem(s) {
  return `${String(s.systemPrompt || GUTEAYRI_DEFAULT_PROMPT).trim()}\n\n${PROTOCOL}${personalRule(s)}${knowledgeBlock(s)}`;
}

function imageParts(images) {
  const parts = [];
  for (const img of images || []) {
    if (img && img.sameAs) {
      parts.push({ type: "text", text: `Image ${img.n} is the same picture as Image ${img.sameAs}.` });
      continue;
    }
    if (!img || !img.data) continue;
    const label = img.label || `Image ${img.n}`;
    // Alt text is already in the page text next to the {{IMG n}} marker.
    parts.push({ type: "text", text: `${label}${img.alt && !img.altInPage ? ` (alt text: ${img.alt})` : ""}:` });
    parts.push({ type: "image", mime: img.mime || "image/jpeg", data: img.data, label });
  }
  return parts;
}

function normalizeAnswers(json) {
  const list = Array.isArray(json) ? json : json.answers || json.questions || [];
  return list
    .filter((a) => a && typeof a === "object")
    .map((a) => ({
      q: String(a.q || a.question || "").trim(),
      answer: typeof a.answer === "string" ? a.answer.trim() : a.answer == null ? "" : JSON.stringify(a.answer),
      confidence: Math.max(0, Math.min(1, Number(a.confidence ?? 0.8) || 0)),
      img: (Array.isArray(a.img) ? a.img : a.img != null ? [a.img] : []).map((n) => parseInt(String(n).replace(/[^\d]/g, ""), 10)).filter(Number.isFinite),
      fills: (Array.isArray(a.fills) ? a.fills : [])
        .map((f) => ({ id: parseInt(String(f.id).replace(/[^\d]/g, ""), 10), value: f.value }))
        .filter((f) => Number.isFinite(f.id)),
    }));
}

/* The site's name is all the model needs from the address. */
function siteOf(url) {
  try {
    return url ? `\nSite: ${new URL(url).hostname}` : "";
  } catch (e) {
    return "";
  }
}

async function solvePage(page) {
  const s = await guteayriLoadSettings();
  // The page text carries each image's alt text next to its {{IMG n}} marker.
  const parts = imageParts((page.images || []).map((img) => Object.assign({ altInPage: true }, img)));
  if (page.screenshot) {
    parts.push({ type: "text", text: "Screenshot of the visible part of the page:" });
    parts.push({ type: "image", mime: page.screenshot.mime, data: page.screenshot.data, label: "Screenshot" });
  }
  parts.push({
    type: "text",
    text: `Page title: ${page.title || "(none)"}${siteOf(page.url)}\n\n--- page ---\n${page.text}\n--- end of page ---\n\nAnswer every question on this page. Reply with the JSON object only.`,
  });
  // Room for the answer plus the model's thinking. A cut-off answer is billed and then retried, so
  // higher reasoning levels start with more room; only the tokens actually written are billed.
  const maxTokens = { high: 32000, max: 64000 }[s.reasoning] || 16000;
  const res = await guteayriCall(s, { system: solveSystem(s), parts, json: true, maxTokens });
  const answers = normalizeAnswers(guteayriExtractJson(res.text));
  return { answers, model: res.model, provider: res.provider, imagesDropped: res.imagesDropped, usage: res.usage };
}

async function askFree({ question, images }) {
  const s = await guteayriLoadSettings();
  const system = `${String(s.systemPrompt || GUTEAYRI_DEFAULT_PROMPT).trim()}\n\nAnswer the question directly. Lead with the answer, then give at most three short sentences of reasoning. Plain text only.${knowledgeBlock(s)}`;
  const parts = imageParts(images);
  parts.push({ type: "text", text: question });
  const res = await guteayriCall(s, { system, parts, json: false, maxTokens: 8000 });
  return { text: res.text.trim(), model: res.model, usage: res.usage };
}

/* Answers a page the content script can't reach (PDF viewer, reader view) from a screenshot. */
async function solveScreenshot(windowId) {
  const shot = await captureTab(windowId, 1800);
  return solvePage({
    title: "(screenshot)",
    url: "",
    text: "This page could only be captured as a screenshot. Read the questions from it. There are no fillable fields, so every entry has \"fills\": [].",
    images: [],
    screenshot: shot,
  });
}

/* ---------- Images ---------- */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

/* An image (data URL, object URL or blob) ready to draw, with its size. */
async function decodeImage(src) {
  if (HAS_DOM) {
    const img = await loadImage(typeof src === "string" ? src : URL.createObjectURL(src));
    return { source: img, w: img.naturalWidth || img.width || 512, h: img.naturalHeight || img.height || 512 };
  }
  const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
  const bmp = await createImageBitmap(blob);
  return { source: bmp, w: bmp.width, h: bmp.height };
}

/* Re-encodes any image as JPEG on white, longest side at most `max`. */
async function normalizeImage(src, max = 1400) {
  const { source, w: w0, h: h0 } = await decodeImage(src);
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const c = HAS_DOM ? Object.assign(document.createElement("canvas"), { width: w, height: h }) : new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const url = HAS_DOM ? c.toDataURL("image/jpeg", 0.9) : await blobToDataUrl(await c.convertToBlob({ type: "image/jpeg", quality: 0.9 }));
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), width: w, height: h };
}

async function fetchImage(url) {
  const res = await fetch(url, { credentials: "include", cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!HAS_DOM) return normalizeImage(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await normalizeImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function captureTab(windowId, max) {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
  if (!max) return { dataUrl };
  return normalizeImage(dataUrl, max);
}

/* ---------- Tabs and frames ---------- */

async function ensureInjected(tabId) {
  try {
    const pong = await browser.tabs.sendMessage(tabId, { type: "ping" }, { frameId: 0 });
    if (pong && pong.ok) return true;
  } catch (e) { /* not injected yet */ }
  // Tabs opened before the extension was installed or reloaded have no content scripts yet.
  try {
    for (const set of browser.runtime.getManifest().content_scripts || []) {
      if (MV3) {
        await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: set.js.map((f) => "/" + f), world: set.world || "ISOLATED" });
      } else {
        for (const file of set.js) {
          await browser.tabs.executeScript(tabId, { file: "/" + file, allFrames: true, matchAboutBlank: true, runAt: "document_end" });
        }
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runTab(tab) {
  if (!tab) return { ok: false, error: "No active tab." };
  const ok = await ensureInjected(tab.id);
  if (!ok) return { ok: false, restricted: true, windowId: tab.windowId };
  await browser.tabs.sendMessage(tab.id, { type: "run", manual: true });
  return { ok: true };
}

async function sendToTop(tabId, msg) {
  if (!(await ensureInjected(tabId))) return false;
  await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
  return true;
}

/* ---------- Messages ---------- */

const errorText = (err) => (err && err.message) || String(err);

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab && sender.tab.id;
  switch (msg && msg.type) {
    case "solve":
      return solvePage(msg.page).then((result) => ({ ok: true, result }), (err) => ({ ok: false, error: errorText(err), code: err.code }));

    case "ask":
      return askFree(msg).then((r) => ({ ok: true, result: r }), (err) => ({ ok: false, error: errorText(err) }));

    case "fetchImage":
      return fetchImage(msg.url).then((img) => ({ ok: true, img }), (err) => ({ ok: false, error: errorText(err) }));

    case "normalizeImage":
      return normalizeImage(msg.dataUrl, msg.max).then((img) => ({ ok: true, img }), (err) => ({ ok: false, error: errorText(err) }));

    case "capture":
      return captureTab(sender.tab.windowId, msg.max).then((img) => ({ ok: true, img }), (err) => ({ ok: false, error: errorText(err) }));

    case "hud": // a child frame reporting to the panel in the top frame
      if (tabId == null) return;
      return browser.tabs.sendMessage(tabId, { type: "hud", op: msg.op, args: msg.args, frameId: sender.frameId }, { frameId: 0 }).catch(() => {});

    case "relay": // the panel asking a child frame to act
      if (tabId == null) return;
      return browser.tabs.sendMessage(tabId, msg.msg, { frameId: msg.frameId }).catch(() => {});

    case "runAll": // re-run from the panel: every frame scans again
      if (tabId == null) return;
      return browser.tabs.sendMessage(tabId, { type: "run", manual: true });

    case "runActive":
      return activeTab().then(runTab);

    case "solveScreenshot":
      return solveScreenshot(msg.windowId).then((result) => ({ ok: true, result }), (err) => ({ ok: false, error: errorText(err) }));

    case "listModels":
      return guteayriLoadSettings()
        .then((s) => {
          if (msg.draft) Object.assign(s.providers[msg.provider], msg.draft);
          return guteayriListModels(s, msg.provider);
        })
        .then((models) => ({ ok: true, models }), (err) => ({ ok: false, error: errorText(err) }));

    case "testConnection":
      return guteayriLoadSettings()
        .then((s) => guteayriCall(s, { system: "Reply with the single word: ready", parts: [{ type: "text", text: "Are you there? Reply in JSON: {\"status\":\"ready\"}" }], json: true, maxTokens: 2000 }))
        .then((r) => ({ ok: true, model: r.model }), (err) => ({ ok: false, error: errorText(err) }));

    case "openOptions":
      return browser.runtime.openOptionsPage();
  }
});

/* ---------- Shortcut and context menus ---------- */

async function selectionIn(tab) {
  // The selection can sit in any frame; ask them all and take the first non-empty one.
  try {
    const results = MV3
      ? (await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => String(getSelection ? getSelection() : "").trim() })).map((r) => r.result)
      : await browser.tabs.executeScript(tab.id, { code: "String(window.getSelection ? window.getSelection() : '').trim()", allFrames: true });
    return (results || []).find((t) => t) || "";
  } catch (e) {
    return "";
  }
}

async function answerSelection(tab, text) {
  const q = String(text || "").trim();
  if (!q) {
    await sendToTop(tab.id, { type: "hud", op: "toast", args: ["Select a question's text first"], frameId: 0 });
    return;
  }
  await sendToTop(tab.id, { type: "hud", op: "ask", args: [q], frameId: 0 });
  try {
    const r = await askFree({ question: q, images: [] });
    await sendToTop(tab.id, { type: "hud", op: "askResult", args: [q, r.text, r.model, r.usage], frameId: 0 });
  } catch (e) {
    await sendToTop(tab.id, { type: "hud", op: "error", args: [errorText(e)], frameId: 0 });
  }
}

async function broadcast(tab, msg) {
  if (!(await ensureInjected(tab.id))) return;
  await browser.tabs.sendMessage(tab.id, msg).catch(() => {});
}

browser.commands.onCommand.addListener(async (command) => {
  const tab = await activeTab();
  if (!tab) return;
  switch (command) {
    case "fill-page": {
      const res = await runTab(tab);
      if (res && res.restricted) (browser.action || browser.browserAction).openPopup().catch(() => {});
      break;
    }
    case "answer-selection":
      await answerSelection(tab, await selectionIn(tab));
      break;
    case "toggle-panel":
      await sendToTop(tab.id, { type: "hud", op: "toggle", args: [], frameId: 0 });
      break;
    case "fill-reviewed":
      await broadcast(tab, { type: "applyPending" });
      break;
    case "undo-fills":
      await broadcast(tab, { type: "undo" });
      await sendToTop(tab.id, { type: "hud", op: "toast", args: ["Fills undone"], frameId: 0 });
      break;
    case "toggle-auto": {
      const s = await guteayriLoadSettings();
      await guteayriSaveSettings({ autoMode: !s.autoMode });
      await sendToTop(tab.id, { type: "hud", op: "toast", args: [s.autoMode ? "Auto mode off" : "Auto mode on"], frameId: 0 });
      break;
    }
  }
});

function createMenus() {
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({ id: "guteayri-fill", title: "Fill this page", contexts: ["page", "frame", "editable"] });
    browser.contextMenus.create({ id: "guteayri-ask", title: "Answer “%s”", contexts: ["selection"] });
    browser.contextMenus.create({ id: "guteayri-image", title: "Answer the question in this image", contexts: ["image"] });
  });
}
browser.runtime.onInstalled.addListener((details) => {
  createMenus();
  if (details.reason === "install") browser.runtime.openOptionsPage();
});
browser.runtime.onStartup.addListener(createMenus);

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "guteayri-fill") return runTab(tab);

  if (info.menuItemId === "guteayri-ask") return answerSelection(tab, info.selectionText);

  if (info.menuItemId === "guteayri-image") {
    const label = "The question in this image";
    await sendToTop(tab.id, { type: "hud", op: "ask", args: [label], frameId: 0 });
    try {
      const img = await fetchImage(info.srcUrl);
      const r = await askFree({ question: "Answer the question shown in Image 1. If it shows several questions, answer each one.", images: [Object.assign({ n: 1 }, img)] });
      await sendToTop(tab.id, { type: "hud", op: "askResult", args: [label, r.text, r.model, r.usage], frameId: 0 });
    } catch (e) {
      await sendToTop(tab.id, { type: "hud", op: "error", args: [errorText(e)], frameId: 0 });
    }
  }
});

createMenus();
