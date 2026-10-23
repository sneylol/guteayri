/* GuteAyri — the in-page answer sheet.
   Lives in the top frame inside a closed shadow root. Child frames report to it through
   the background page, so every operation takes the reporting frameId first. */
(() => {
  const GR = globalThis.GR;
  if (GR.hud) return;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .sheet {
    --paper: #FBFBF9; --ink: #D8435B; --ink-deep: #B4304A; --rule: #F1CBD2; --wash: #FCEEF1;
    --lead: #2A2B30; --lead-hi: #4D4F57; --text: #232428; --muted: #6C6E76; --on-lead: #FBFBF9;
    --sans: "GuteAyri Barlow", "Barlow", "Helvetica Neue", Arial, sans-serif;
    --cond: "GuteAyri Barlow Condensed", "Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
    position: relative; width: 372px; max-width: calc(100vw - 24px);
    background: var(--paper); color: var(--text); font: 400 13px/1.4 var(--sans);
    border: 1px solid var(--rule); border-radius: 6px;
    box-shadow: 0 1px 0 rgba(42,43,48,.05), 0 18px 40px -14px rgba(42,43,48,.35);
    overflow: hidden; -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .sheet {
      --paper: #1C1D21; --ink: #F07A8C; --ink-deep: #F59AA8; --rule: #47303A; --wash: #2A2025;
      --lead: #ECEAE4; --lead-hi: #FFFFFF; --text: #ECEBE7; --muted: #A0A2AA; --on-lead: #1C1D21;
      box-shadow: 0 18px 44px -12px rgba(0,0,0,.7);
    }
  }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  button:focus-visible, .row:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 3px; }

  .bar { display: flex; align-items: center; gap: 8px; padding: 10px 10px 9px 14px; cursor: grab; user-select: none;
         border-bottom: 3px double var(--ink); }
  .bar:active { cursor: grabbing; }
  .logo { width: 20px; height: 20px; flex: none; }
  .name { font: 700 17px/1 var(--cond); letter-spacing: .01em; color: var(--text); }
  .status { flex: 1; min-width: 0; text-align: right; font: 500 13px/1.2 var(--cond); color: var(--muted);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 2px; }
  .status[data-tone=ink] { color: var(--ink); }
  .ico { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); flex: none; }
  .ico:hover { background: var(--wash); color: var(--ink); }
  .ico svg { width: 15px; height: 15px; }

  .body { max-height: min(62vh, 560px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
          scrollbar-color: var(--rule) transparent; }
  .rows { list-style: none; margin: 0; padding: 6px 0 8px; }
  .row { position: relative; display: grid; grid-template-columns: 26px 1fr; column-gap: 6px;
         padding: 9px 14px 10px 18px; cursor: pointer; }
  .row + .row { border-top: 1px solid var(--rule); }
  .row:hover { background: var(--wash); }
  .tm { position: absolute; left: 0; top: 13px; width: 9px; height: 5px; background: var(--lead); }
  .row[data-status=unfilled] .tm, .row[data-status=review] .tm { background: transparent; box-shadow: inset 0 0 0 1px var(--lead); }
  .row[data-status=failed] .tm { background: var(--ink); }
  .num { font: 600 15px/1.25 var(--cond); color: var(--ink); text-align: right; padding-top: 1px; }
  .q { font: 500 13px/1.35 var(--sans); color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ans { grid-column: 2; margin-top: 7px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
  .bubbles { display: inline-flex; gap: 5px; flex-wrap: wrap; }
  .b { position: relative; width: 21px; height: 21px; border-radius: 50%; border: 1.25px solid var(--ink);
       display: grid; place-items: center; font: 600 11px/1 var(--cond); color: var(--ink); overflow: hidden; flex: none; }
  .b::after { content: ""; position: absolute; inset: -1px; border-radius: 50%; clip-path: circle(0% at 28% 62%);
              background:
                repeating-linear-gradient(118deg, rgba(255,255,255,.07) 0 1px, transparent 1px 3px),
                radial-gradient(circle at 34% 30%, var(--lead-hi), var(--lead) 62%); }
  .b span { position: relative; z-index: 1; }
  .b.on { border-color: var(--lead); color: var(--on-lead); }
  .b.on::after { animation: pencil .48s cubic-bezier(.3,.7,.2,1) forwards; animation-delay: calc(var(--i, 0) * 70ms); }
  .row[data-status=review] .b.on::after { animation: none; clip-path: circle(80% at 50% 50%); opacity: .35; }
  .row[data-status=review] .b.on { color: var(--lead); }
  @keyframes pencil { 0% { clip-path: circle(0% at 28% 62%); } 100% { clip-path: circle(80% at 50% 50%); } }
  .pick { font: 400 12.5px/1.3 var(--sans); color: var(--muted); min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .write { grid-column: 2; margin-top: 6px; font: 400 13px/1.5 var(--sans); color: var(--text);
           padding: 1px 0 2px; white-space: pre-wrap; word-break: break-word;
           background: linear-gradient(transparent calc(100% - 1px), var(--rule) 0) 0 0 / 100% 1.5em;
           display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .row.open .write { -webkit-line-clamp: unset; display: block; }
  .row.open .q { -webkit-line-clamp: unset; }
  .note { grid-column: 2; margin-top: 5px; font: 500 12px/1.3 var(--cond); color: var(--muted); }
  .img-tag { display: inline-block; margin-left: 6px; padding: 0 4px; border: 1px solid var(--ink); border-radius: 3px;
    font: 600 10.5px/15px var(--cond); letter-spacing: .04em; color: var(--ink); vertical-align: 1px; white-space: nowrap; }
  .note.warn { color: var(--ink); }
  .row[data-low] .b.on { outline: 1.5px dashed var(--ink); outline-offset: 2px; }

  .working { padding: 22px 18px 20px; display: grid; justify-items: start; gap: 12px; }
  .scan { display: inline-flex; gap: 7px; }
  .scan .b::after { animation: scan 2.2s ease-in-out infinite; animation-delay: calc(var(--i) * .44s); }
  .scan .b { animation: scanInk 2.2s ease-in-out infinite; animation-delay: calc(var(--i) * .44s); }
  @keyframes scan { 0%, 8% { clip-path: circle(0% at 28% 62%); } 22%, 40% { clip-path: circle(80% at 50% 50%); } 56%, 100% { clip-path: circle(0% at 72% 38%); } }
  @keyframes scanInk { 0%, 8%, 56%, 100% { color: var(--ink); } 22%, 40% { color: var(--on-lead); } }
  .wtext { font: 500 15px/1.3 var(--cond); color: var(--text); }
  .wsub { font: 400 12.5px/1.4 var(--sans); color: var(--muted); margin-top: -6px; }

  .empty, .err { padding: 20px 18px; font: 400 13px/1.5 var(--sans); }
  .err h3, .empty h3 { margin: 0 0 4px; font: 600 16px/1.2 var(--cond); }
  .err h3 { color: var(--ink); }
  .err p, .empty p { margin: 0; color: var(--muted); }
  .err .btn { margin-top: 12px; }

  .foot { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 14px; border-top: 1px solid var(--rule); }
  .meta { flex: 1; min-width: 0; font: 500 12px/1.2 var(--cond); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btn { height: 28px; padding: 0 11px; border-radius: 4px; font: 600 13px/1 var(--cond); letter-spacing: .02em; }
  .btn.ghost { color: var(--text); box-shadow: inset 0 0 0 1px var(--rule); }
  .btn.ghost:hover { box-shadow: inset 0 0 0 1px var(--ink); color: var(--ink); }
  .btn.solid { background: var(--lead); color: var(--on-lead); }
  .btn.solid:hover { background: var(--ink); color: #fff; }

  .sheet.min { width: auto; border-radius: 999px; }
  .sheet.min .bar { border-bottom: 0; padding: 6px 8px 6px 10px; }
  .sheet.min .body, .sheet.min .foot, .sheet.min [data-act=rerun] { display: none; }
  .sheet.min .status { flex: none; }

  .toast { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); background: var(--lead); color: var(--on-lead);
           font: 600 12.5px/1 var(--cond); padding: 7px 11px; border-radius: 4px; white-space: nowrap; pointer-events: none;
           opacity: 0; transition: opacity .2s ease; }
  .toast.show { opacity: 1; }

  @media (prefers-reduced-motion: reduce) {
    .b.on::after { animation: none; clip-path: circle(80% at 50% 50%); }
    .scan .b, .scan .b::after { animation-duration: 6s; }
  }`;

  const ICON = {
    logo: `<svg class="logo" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="none" stroke="var(--ink)" stroke-width="1.4"/><ellipse cx="10.3" cy="10.4" rx="6.1" ry="5.6" transform="rotate(-14 10 10)" fill="var(--lead)"/></svg>`,
    rerun: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 6.2A5.5 5.5 0 1 0 13.5 10"/><path d="M13.6 2.6v3.8H9.8"/></svg>`,
    min: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 8h9"/></svg>`,
    close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  };

  // Icons are constant strings; parse them as SVG rather than assigning markup.
  const svgCache = new Map();
  function svgNode(markup) {
    if (!svgCache.has(markup)) svgCache.set(markup, new DOMParser().parseFromString(markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '), "image/svg+xml").documentElement);
    return document.importNode(svgCache.get(markup), true);
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "svg") el.append(svgNode(v));
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style") el.setAttribute("style", v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }

  const state = {
    phase: "idle", // idle | working | done | error | empty
    status: "",
    tone: "",
    sub: "",
    frames: new Map(), // frameId -> { rows, review, model }
    asks: [],
    error: null,
    minimized: false,
  };

  let root = null, sheet = null, toastEl = null, toastTimer = null;

  function mount() {
    if (root) return;
    const host = document.createElement("div");
    host.id = "guteayri-hud-host";
    // Hidden until something asks to show it, so a quiet run can keep its results without appearing.
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;display:none;margin:0;padding:0;border:0;";
    root = host.attachShadow({ mode: "closed" });
    root.append(h("style", {}, CSS));
    sheet = h("div", { class: "sheet", role: "dialog", "aria-label": "GuteAyri answers" });
    root.append(sheet);
    document.documentElement.appendChild(host);
    GR.hostEl = host;
    GR.loadFonts();
    enableDrag(host);
  }

  function enableDrag(host) {
    let sx, sy, ox, oy, dragging = false;
    sheet.addEventListener("pointerdown", (e) => {
      const bar = e.composedPath().find((n) => n.classList && n.classList.contains("bar"));
      if (!bar || e.composedPath().some((n) => n.localName === "button")) return;
      const r = host.getBoundingClientRect();
      dragging = true;
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      bar.setPointerCapture(e.pointerId);
    });
    sheet.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const x = Math.min(window.innerWidth - 60, Math.max(0, ox + e.clientX - sx));
      const y = Math.min(window.innerHeight - 40, Math.max(0, oy + e.clientY - sy));
      host.style.left = x + "px";
      host.style.top = y + "px";
      host.style.right = "auto";
      host.style.bottom = "auto";
    });
    sheet.addEventListener("pointerup", () => (dragging = false));
  }

  function allRows() {
    const out = [];
    for (const [frameId, f] of state.frames) for (const r of f.rows) out.push(Object.assign({ frameId }, r));
    return out;
  }

  function counts() {
    const rows = allRows();
    const filled = rows.filter((r) => r.status === "filled").length;
    const fillable = rows.filter((r) => r.status !== "unfilled" || r.reviewable).length;
    return { rows, filled, fillable };
  }

  function forFrame(frameId, msg) {
    if (frameId === 0) return GR.handleLocal(msg);
    return GR.send({ type: "relay", frameId, msg });
  }

  function anyReview() {
    for (const f of state.frames.values()) if (f.review) return true;
    return false;
  }

  function render() {
    mount();
    sheet.classList.toggle("min", state.minimized);
    sheet.replaceChildren();
    const { rows, filled } = counts();

    let statusText = state.status;
    if (state.phase === "done") {
      statusText = anyReview() ? `${rows.length} answers ready` : rows.length ? `Filled ${filled} of ${rows.length}` : "Done";
    }
    if (state.minimized && state.phase === "done") statusText = rows.length ? `${filled}/${rows.length}` : "Done";

    sheet.append(
      h("header", { class: "bar" },
        h("span", { svg: ICON.logo, style: "display:contents" }),
        h("span", { class: "name" }, "GuteAyri"),
        h("span", { class: "status", "data-tone": state.tone || null, "aria-live": "polite" }, statusText),
        h("button", { class: "ico", "data-act": "rerun", title: "Run again", "aria-label": "Run again", svg: ICON.rerun, onclick: () => GR.send({ type: "runAll" }) }),
        h("button", { class: "ico", title: state.minimized ? "Expand" : "Minimize", "aria-label": state.minimized ? "Expand" : "Minimize", svg: ICON.min,
          onclick: () => { state.minimized = !state.minimized; render(); } }),
        h("button", { class: "ico", title: "Close", "aria-label": "Close", svg: ICON.close, onclick: () => hide() })
      )
    );

    const body = h("div", { class: "body" });
    sheet.append(body);

    if (state.phase === "working") {
      body.append(
        h("div", { class: "working" },
          h("div", { class: "scan", "aria-hidden": "true" }, ["A", "B", "C", "D", "E"].map((l, i) => h("span", { class: "b", style: `--i:${i}` }, h("span", {}, l)))),
          h("div", { class: "wtext" }, state.status || "Reading the page"),
          state.sub ? h("div", { class: "wsub" }, state.sub) : null
        )
      );
    } else if (state.phase === "error") {
      const e = state.error || {};
      body.append(
        h("div", { class: "err", role: "alert" },
          h("h3", {}, e.title || "Couldn't answer this page"),
          h("p", {}, e.message || ""),
          e.settings ? h("button", { class: "btn solid", onclick: () => GR.send({ type: "openOptions" }) }, "Open settings") : null
        )
      );
    } else if (state.phase === "empty" && !state.asks.length) {
      body.append(
        h("div", { class: "empty" },
          h("h3", {}, "No questions found"),
          h("p", {}, "GuteAyri didn't find anything to answer here. Select a question's text and choose “Answer” from the right-click menu, or run again once the questions have loaded.")
        )
      );
    }

    const list = h("ol", { class: "rows" });
    state.asks.forEach((a) => list.append(askRow(a)));
    rows.forEach((r, i) => list.append(answerRow(r, i)));
    if (list.childNodes.length) body.append(list);

    if (state.phase === "done" || state.asks.length) {
      const models = [...new Set([...state.frames.values()].map((f) => f.model).concat(state.asks.map((a) => a.model)).filter(Boolean))];
      // Cost first, so it stays visible when the line is cut short.
      const meta = [usageText(), imagesText(), models.join(", ")].filter(Boolean).join(" · ");
      const foot = h("footer", { class: "foot" }, h("span", { class: "meta", title: meta }, meta));
      if (rows.length) {
        foot.append(h("button", { class: "btn ghost", onclick: copyAll }, "Copy"));
        if (rows.some((r) => r.status === "filled")) foot.append(h("button", { class: "btn ghost", onclick: undo }, "Undo"));
        if (anyReview()) foot.append(h("button", { class: "btn solid", onclick: applyReviewed }, "Fill answers"));
      }
      sheet.append(foot);
    }

    toastEl = h("div", { class: "toast", role: "status" });
    sheet.append(toastEl);
  }

  function answerRow(r, i) {
    const li = h("li", {
      class: "row",
      tabindex: "0",
      "data-status": r.status,
      "data-low": r.confidence < 0.6 ? "" : null,
      title: r.q,
    });
    // "IMG 1": this question's picture went to the model with it.
    const tags = (r.images || []).map((n) => h("span", { class: "img-tag", title: `Image ${n} was sent with this question` }, `IMG ${n}`));
    li.append(h("span", { class: "tm", "aria-hidden": "true" }), h("span", { class: "num" }, i + 1), h("div", { class: "q" }, r.q || "Question", ...tags));

    if (r.kind === "choice" && r.options.length) {
      const chosen = r.options.filter((o) => o.chosen);
      let k = 0;
      li.append(
        h("div", { class: "ans" },
          h("span", { class: "bubbles", "aria-label": `Answer ${chosen.map((o) => o.letter).join(", ") || "none"}` },
            r.options.map((o) => h("span", { class: "b" + (o.chosen ? " on" : ""), style: o.chosen ? `--i:${k++}` : null, title: o.label }, h("span", {}, o.letter)))
          ),
          h("span", { class: "pick" }, chosen.map((o) => o.label).join(" · ") || r.answer)
        )
      );
    } else {
      li.append(h("div", { class: "write" }, r.text || r.answer || "—"));
    }

    let note = null, warn = false;
    if (r.status === "unfilled" && !r.reviewable) note = "Answer only. There's no field to fill for this one.";
    else if (r.status === "failed") { note = `Not filled: ${r.reason || "the field didn't accept the answer"}.`; warn = true; }
    else if (r.status === "partial") { note = `Partly filled: ${r.reason || "some fields didn't accept the answer"}.`; warn = true; }
    if (r.confidence < 0.6) { note = (note ? note + " " : "") + "Low confidence, worth checking."; warn = true; }
    if (note) li.append(h("div", { class: "note" + (warn ? " warn" : "") }, note));

    const act = () => {
      li.classList.toggle("open");
      if (r.ids && r.ids.length) forFrame(r.frameId, { type: "flash", ids: r.ids });
    };
    li.addEventListener("click", act);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    return li;
  }

  function askRow(a) {
    const li = h("li", { class: "row", "data-status": a.pending ? "review" : "filled" });
    li.append(h("span", { class: "tm", "aria-hidden": "true" }), h("span", { class: "num" }, "?"), h("div", { class: "q" }, a.q));
    li.append(h("div", { class: "write", style: "-webkit-line-clamp:unset;display:block" }, a.pending ? "Thinking…" : a.text));
    li.addEventListener("click", () => li.classList.toggle("open"));
    return li;
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl && toastEl.classList.remove("show"), 1800);
  }

  async function copyAll() {
    const lines = allRows().map((r, i) => {
      const a = r.kind === "choice" && r.options.some((o) => o.chosen)
        ? r.options.filter((o) => o.chosen).map((o) => `${o.letter}) ${o.label}`).join(", ")
        : r.text || r.answer;
      return `${i + 1}. ${r.q}\n   ${a}`;
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("Answers copied");
    } catch (e) {
      toast("Couldn't reach the clipboard");
    }
  }

  async function undo() {
    for (const frameId of state.frames.keys()) await forFrame(frameId, { type: "undo" });
    for (const f of state.frames.values()) {
      f.rows.forEach((r) => { if (r.status === "filled" || r.status === "partial") { r.status = "review"; r.reviewable = true; } });
      f.review = true;
    }
    render();
    toast("Fills undone");
  }

  async function applyReviewed() {
    for (const [frameId, f] of state.frames) if (f.review) await forFrame(frameId, { type: "applyPending" });
  }

  /* Tokens this run cost, summed over frames and answered selections: "14k in (12k cached) · 1.2k out". */
  function usageText() {
    const sum = { input: 0, output: 0, cached: 0, cost: 0, costKnown: true };
    for (const u of [...state.frames.values()].map((f) => f.usage).concat(state.asks.map((a) => a.usage))) {
      if (!u) continue;
      for (const k of ["input", "output", "cached", "cost"]) sum[k] += u[k] || 0;
      if (!u.costKnown) sum.costKnown = false;
    }
    if (!sum.input && !sum.output) return "";
    const n = (x) => (x < 1000 ? String(x) : `${(x / 1000).toFixed(x < 10000 ? 1 : 0)}k`);
    const tokens = `${n(sum.input)} in${sum.cached ? ` (${n(sum.cached)} cached)` : ""} · ${n(sum.output)} out`;
    return sum.costKnown ? `≈ ${dollars(sum.cost)} · ${tokens}` : tokens;
  }

  /* How many pictures the model received, so a person can check a diagram was sent along. */
  function imagesText() {
    const frames = [...state.frames.values()];
    if (frames.some((f) => f.imagesDropped)) return "images not sent: this model can't see them";
    const n = frames.reduce((sum, f) => sum + (f.images || 0), 0);
    const pictures = n ? `${n} image${n === 1 ? "" : "s"}` : "";
    // The screenshot is named on its own, so "1 image" always means a picture from the page itself.
    return frames.some((f) => f.screenshot) ? (pictures ? `${pictures} + screenshot` : "screenshot") : pictures;
  }

  /* $0.0042 · $0.019 · $1.24: enough digits to tell runs apart. */
  function dollars(x) {
    if (x >= 1) return `$${x.toFixed(2)}`;
    if (x >= 0.01) return `$${x.toFixed(3)}`;
    return `$${x.toFixed(4)}`;
  }

  function hide() {
    if (GR.hostEl) GR.hostEl.style.display = "none";
  }

  function show() {
    mount();
    GR.hostEl.style.display = "block";
  }

  function visible() {
    return !!GR.hostEl && GR.hostEl.style.display !== "none";
  }

  /* "Show the answer panel" off: runs fill quietly and the panel only opens on request. */
  let quiet = false;
  guteayriLoadSettings().then((s) => { quiet = s.showPanel === false; });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings && changes.settings.newValue) quiet = changes.settings.newValue.showPanel === false;
  });
  const showUnlessQuiet = () => { if (!quiet || visible()) show(); };

  /* A short message in a pill that goes away by itself. */
  function pill(text, ms) {
    const wasMin = state.minimized, wasStatus = state.status;
    state.minimized = true;
    state.status = text;
    show();
    render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.minimized = wasMin;
      state.status = wasStatus;
      hide();
    }, ms);
  }

  GR.hud = {
    start(frameId, status, sub) {
      if (frameId === 0) {
        state.frames.clear();
        state.asks = [];
      } else {
        state.frames.delete(frameId);
      }
      state.phase = "working";
      state.status = status || "Reading the page";
      state.sub = sub || "";
      state.tone = "";
      state.minimized = false;
      showUnlessQuiet();
      render();
    },
    status(frameId, status, sub) {
      if (state.phase !== "working") return;
      state.status = status;
      state.sub = sub || "";
      render();
    },
    results(frameId, rows, meta) {
      state.frames.set(frameId, { rows, review: !!(meta && meta.review), model: meta && meta.model, usage: meta && meta.usage,
        images: meta ? meta.imagesSent || 0 : 0, screenshot: !!(meta && meta.screenshotSent), imagesDropped: !!(meta && meta.imagesDropped) });
      const total = allRows().length;
      state.phase = total || state.asks.length ? "done" : "empty";
      state.tone = "";
      // Answers waiting for review need the panel's Fill button, so they always show.
      if (meta && meta.review) show();
      else showUnlessQuiet();
      render();
      if (meta && meta.imagesDropped) toast("This model can't see images; answered from text only");
    },
    update(frameId, rows, review) {
      const f = state.frames.get(frameId);
      if (!f) return;
      f.rows = rows;
      f.review = !!review;
      render();
    },
    error(frameId, message, opts) {
      const settings = /settings|api key|base url|choose a model/i.test(message || "");
      state.phase = "error";
      state.error = { message, settings, title: (opts && opts.title) || null };
      state.tone = "ink";
      state.status = "Stopped";
      if (quiet && !visible()) {
        // Quiet runs still say when they fail; the full message is in the panel.
        render();
        pill("Stopped. Open the answer panel for details.", 4000);
        return;
      }
      show();
      render();
    },
    ask(frameId, q) {
      state.frames.clear();
      state.asks = [{ q, pending: true }];
      state.phase = "done";
      state.status = "";
      show();
      render();
    },
    askResult(frameId, q, text, model, usage) {
      state.asks = [{ q, text, model, usage }];
      state.phase = "done";
      show();
      render();
    },
    toast(frameId, text) {
      if (state.phase === "idle" || !visible()) {
        // Nothing on the sheet yet: show the message as a minimized pill that goes away.
        pill(text, 1800);
        return;
      }
      toast(text);
    },
    toggle() {
      if (visible()) hide();
      else { show(); render(); }
    },
    hide,
  };
})();
