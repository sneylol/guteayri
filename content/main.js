/* GuteAyri — orchestrates a run: scan → images → model → fill → report. Also runs auto mode. */
(() => {
  const GR = globalThis.GR;
  if (GR.run) return;

  // Child frames talk to the panel in the top frame through the background page.
  const panel = GR.isTop
    ? GR.hud
    : new Proxy({}, { get: (_, op) => (_frameId, ...args) => GR.send({ type: "hud", op, args }).catch(() => {}) });

  GR.seen = new WeakSet();
  GR.pending = null; // { answers, rows, meta } waiting for review

  const BASE_CANDIDATES = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=password]), textarea, select, [role=radio], [role=checkbox], [role=option], [role=combobox], [contenteditable=''], [contenteditable=true]";
  // Adapters add widgets that have no form field of their own (drop zones, sortable items).
  const candidates = () => (GR.autoCandidates ? `${BASE_CANDIDATES}, ${GR.autoCandidates}` : BASE_CANDIDATES);

  /* Candidates in the page and in the same-origin frames the scanner also reads (rich-text editors live in frames). */
  function candidateEls() {
    const sel = candidates();
    const out = [];
    const visit = (doc, depth) => {
      out.push(...doc.querySelectorAll(sel));
      if (depth >= 3) return;
      for (const fr of doc.querySelectorAll("iframe, frame")) {
        let inner = null;
        try { inner = fr.contentDocument; } catch (e) { /* cross-origin: that frame watches itself */ }
        if (inner) visit(inner, depth + 1);
      }
    };
    visit(document, 0);
    return out;
  }

  function markSeen(fields) {
    for (const f of fields) GR.seen.add(f.el);
    for (const el of candidateEls()) GR.seen.add(el);
  }

  /* The question's own text, for rows where the model left "q" out (questions with a "### Question N" heading). */
  function titleFromPage(fields) {
    let el = fields[0] && fields[0].el;
    if (!el) return "";
    // An editor in an iframe belongs to the question around its frame.
    if (el.ownerDocument !== document && GR.view(el).frameElement) el = GR.view(el).frameElement;
    const que = el.closest && el.closest(".que");
    if (!que) return "";
    const text = que.querySelector(".qtext");
    const no = que.querySelector(".info .no");
    return GR.clip((text && (text.innerText || text.textContent)) || (no && no.textContent) || "", 90);
  }

  /* Which sent pictures belong to each answer: those inside the same Moodle question as its fields,
     plus any the model says the question showed. Only pictures that reached the model count. */
  function rowImages(a, fields, pics) {
    const out = new Set((a.img || []).filter((n) => pics.sent.has(n)));
    let el = fields[0] && fields[0].el;
    if (el && el.ownerDocument !== document && GR.view(el).frameElement) el = GR.view(el).frameElement;
    const que = el && el.closest && el.closest(".que");
    if (que) for (const [n, img] of pics.els) if (pics.sent.has(n) && que.contains(img)) out.add(n);
    return [...out].sort((x, y) => x - y);
  }

  function buildRows(answers, pics = { sent: new Set(), els: new Map() }) {
    return answers.map((a) => {
      const fields = a.fills.map((f) => GR.fieldById(f.id)).filter(Boolean);
      const choice = fields.filter((f) => GR.CHOICE_KINDS.has(f.kind));
      let kind = "text", options = [], text = "";
      if (choice.length && choice.length === fields.length) {
        kind = "choice";
        let members = choice[0].group ? GR.groupMembers(choice[0].group).filter((m) => GR.CHOICE_KINDS.has(m.kind)) : [];
        if (!members.length || members.length > 12 || !choice.every((f) => members.includes(f))) members = choice;
        const chosen = new Set(a.fills.filter((f) => GR.toBool(f.value)).map((f) => f.id));
        options = members.map((m, i) => ({ letter: GR.letter(i), label: GR.clip(m.label || "", 90), chosen: chosen.has(m.id) }));
      } else if (fields.length) {
        // Typed fields show what was typed; choices among them (a unit's radio, a Cloze option) show their label.
        text = a.fills
          .map((f) => {
            const field = GR.fieldById(f.id);
            if (!field) return null;
            if (GR.CHOICE_KINDS.has(field.kind)) return GR.toBool(f.value) ? GR.clip(field.label || "", 90) || "✓" : null;
            return Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "");
          })
          .filter((t) => t !== null)
          .join(fields.length > 1 ? "  ·  " : "");
      } else {
        text = a.answer;
      }
      return {
        q: a.q || titleFromPage(fields),
        images: rowImages(a, fields, pics),
        answer: a.answer,
        confidence: a.confidence,
        kind,
        options,
        text,
        ids: fields.map((f) => f.id),
        status: fields.length ? "review" : "unfilled",
        reviewable: fields.length > 0,
      };
    });
  }

  async function applyAnswers(answers, rows) {
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i], row = rows[i];
      if (!a.fills.length) continue;
      let ok = 0, failed = 0, reason = "";
      for (const fill of a.fills) {
        const field = GR.fieldById(fill.id);
        const res = await GR.applyFill(fill);
        if (res.ok && !res.skipped) {
          ok++;
          // Choices marked false were deliberately left unselected; only outline the picks.
          const pick = !field || !GR.CHOICE_KINDS.has(field.kind) || GR.toBool(fill.value);
          if (field && pick) GR.mark(field, a.confidence < 0.6 ? "unsure" : "filled");
          else if (field && field.markEl) field.markEl.removeAttribute("data-guteayri-mark");
        } else if (!res.ok) {
          failed++;
          reason = reason || res.reason;
          if (field) GR.mark(field, "failed");
        }
        await GR.sleep(25);
      }
      row.status = failed === 0 ? (ok ? "filled" : "unfilled") : ok ? "partial" : "failed";
      row.reason = reason;
      if (row.status === "unfilled") row.reviewable = false;
    }
    // Some pages need a moment after the last fill (STACK checks each answer on the server).
    if (GR.afterFills) await GR.afterFills();
    // Undo turns this set back into one the person can review and fill again.
    GR.lastApplied = { answers, rows };
    return rows;
  }

  GR.run = async function run({ auto = false } = {}) {
    if (GR.busy) return;
    if (GR.handledByParent()) return;
    GR.busy = true;
    const s = await GR.settings();
    let started = false;
    const start = (status, sub) => {
      if (!started) panel.start(0, status, sub);
      else panel.status(0, status, sub);
      started = true;
    };

    try {
      if (GR.isTop) start("Reading the page");
      const scan = GR.scan({ maxImages: s.maxImages, maxChars: s.maxChars, clickButtons: s.clickButtons });
      const fresh = scan.fields.filter((f) => !GR.seen.has(f.el));
      markSeen(scan.fields);

      // Cross-origin frames only speak up when they hold fields.
      if (!GR.isTop && !scan.fields.length) return;
      if (auto && !fresh.length) {
        if (started && GR.isTop) panel.hide();
        return;
      }
      // The questions live in an embedded frame; that frame reports on its own.
      if (GR.isTop && !scan.fields.length && scan.remoteFrames > 0) {
        panel.results(0, [], {});
        return;
      }

      const model = guteayriActiveModel(s);
      const fieldWord = scan.fields.length === 1 ? "field" : "fields";
      start(`Found ${scan.fields.length} ${fieldWord}`, scan.images.length ? `Reading ${scan.images.length} image${scan.images.length > 1 ? "s" : ""}` : "");

      const images = scan.images.length
        ? await GR.collectImages(scan.images, (i, n) => panel.status(0, `Found ${scan.fields.length} ${fieldWord}`, `Reading image ${i} of ${n}`))
        : [];
      const screenshot = s.includeScreenshot && GR.isTop ? await GR.captureViewport(1600) : null;

      const effort = s.reasoning === "off" ? "no reasoning" : `${s.reasoning} reasoning`;
      start(`Asking ${model}`, `${effort}. Large pages and high reasoning can take a minute.`);

      const res = await GR.send({
        type: "solve",
        page: { title: document.title, url: location.href, text: scan.text, images, screenshot },
      });
      if (!res || !res.ok) throw new Error((res && res.error) || "No response from the background page.");

      const { answers, imagesDropped } = res.result;
      // A picture counts as sent when it was collected (a repeat counts through its twin) and the model could take images.
      const pics = {
        sent: new Set(imagesDropped ? [] : images.map((i) => i.n)),
        els: new Map(scan.images.map((i) => [i.n, i.el])),
      };
      const rows = buildRows(answers, pics);
      // Pictures from the page the model received (repeats are sent once), and the screenshot apart from them.
      const imagesSent = imagesDropped ? 0 : images.filter((i) => !i.sameAs).length;
      const meta = { model: res.result.model, imagesDropped, usage: res.result.usage, imagesSent, screenshotSent: !!screenshot && !imagesDropped };

      if (s.reviewFirst) {
        GR.pending = { answers, rows, meta };
        panel.results(0, rows, Object.assign({ review: true }, meta));
      } else {
        await applyAnswers(answers, rows);
        panel.results(0, rows, meta);
      }
    } catch (err) {
      panel.error(0, err.message || String(err));
    } finally {
      GR.busy = false;
    }
  };

  GR.handleLocal = async (msg) => {
    switch (msg.type) {
      case "flash":
        GR.flash(msg.ids || []);
        return;
      case "undo":
        await GR.undoAll();
        GR.pending = GR.lastApplied || GR.pending;
        return;
      case "applyPending": {
        const p = GR.pending;
        if (!p) return;
        GR.pending = null;
        await applyAnswers(p.answers, p.rows);
        panel.update(0, p.rows, false);
        return;
      }
    }
  };

  /* ---------- Messages ---------- */

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "ping":
        return Promise.resolve({ ok: true, top: GR.isTop });
      case "run":
        GR.run({ auto: false });
        return GR.isTop ? Promise.resolve({ ok: true }) : undefined;
      case "hud":
        if (GR.isTop && GR.hud[msg.op]) GR.hud[msg.op](msg.frameId || 0, ...(msg.args || []));
        return;
      case "getSelection": {
        const t = String(window.getSelection ? window.getSelection() : "").trim();
        return t ? Promise.resolve({ text: t }) : undefined;
      }
      case "flash":
      case "undo":
      case "applyPending":
        GR.handleLocal(msg);
        return;
    }
  });

  /* ---------- Auto mode ---------- */

  let observer = null, timer = null, autoRuns = 0, lastAuto = 0;

  function hasFreshFields() {
    for (const el of candidateEls()) {
      if (GR.seen.has(el) || el.closest("#guteayri-hud-host")) continue;
      if (el.disabled) continue;
      if (GR.visible(el) || (el.labels && [...el.labels].some(GR.visible))) return true;
    }
    return false;
  }

  function scheduleAuto(delay) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (GR.busy || autoRuns >= 40) return;
      if (Date.now() - lastAuto < 4000) return scheduleAuto(4000);
      if (!hasFreshFields()) return;
      autoRuns++;
      lastAuto = Date.now();
      await GR.run({ auto: true });
    }, delay);
  }

  async function syncAuto() {
    const s = await GR.settings();
    const on = s.autoMode && guteayriSiteAllowed(s.autoSites, location.href) && !GR.handledByParent();
    if (on && !observer) {
      observer = new MutationObserver((records) => {
        if (records.every((r) => r.target && r.target.id === "guteayri-hud-host")) return;
        scheduleAuto(1800);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scheduleAuto(1200);
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
      clearTimeout(timer);
    }
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) syncAuto();
  });
  syncAuto();
})();
