/* GuteAyri — page scanner.
   Walks the composed tree (shadow roots, slots, same-origin iframes) in reading order and
   produces plain text with inline markers for every field and image:
     {{#12 radio g3 "Paris"}}   {{IMG 2}}
   Field ids stay stable across scans so later runs can tell new fields from old ones. */
(() => {
  const GR = globalThis.GR;
  if (GR.scan) return;

  const SKIP_TAGS = new Set([
    "script", "style", "noscript", "template", "head", "meta", "link", "title", "object",
    "embed", "audio", "source", "track", "map", "area", "datalist",
  ]);
  const BLOCK_TAGS = new Set([
    "address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "fieldset",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
    "legend", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody",
    "thead", "tfoot", "tr", "ul", "caption", "center",
  ]);
  const NO_FIELD_INPUTS = new Set(["hidden", "submit", "button", "reset", "image", "file", "password"]);
  const CHOICE_KINDS = new Set(["radio", "checkbox", "aria-radio", "aria-checkbox", "option", "button"]);
  const BUTTON_DENY = /\b(submit|send|next|previous|prev|back|finish|done|save|continue|start|begin|close|cancel|delete|remove|log ?out|sign ?(in|out|up)|menu|search|share|print|help|settings|flag|clear (my )?choice|move (up|down|left|right|forward|backward)|abgeben|weiter|zurück|speichern|beenden|senden|absenden|markieren)\b/i;
  const SENSITIVE_AUTOCOMPLETE = /\b(cc-|current-password|new-password|one-time-code)/i;

  const reg = (GR.registry = {
    byId: new Map(),
    idOf: new WeakMap(),
    nextId: 1,
    groupKeys: new Map(),
    groupOfEl: new WeakMap(),
    nextGroup: 1,
  });

  GR.CHOICE_KINDS = CHOICE_KINDS;

  function idFor(el) {
    let id = reg.idOf.get(el);
    if (!id) {
      id = reg.nextId++;
      reg.idOf.set(el, id);
    }
    return id;
  }

  function groupForKey(key) {
    let g = reg.groupKeys.get(key);
    if (!g) {
      g = reg.nextGroup++;
      reg.groupKeys.set(key, g);
    }
    return g;
  }

  function groupForEl(container) {
    let g = reg.groupOfEl.get(container);
    if (!g) {
      g = reg.nextGroup++;
      reg.groupOfEl.set(container, g);
    }
    return g;
  }

  function choiceGroup(el, kind) {
    if (kind === "radio" || kind === "checkbox") {
      const name = el.getAttribute("name");
      if (name) {
        const form = el.form ? idFor(el.form) : 0;
        const base = kind === "checkbox" ? name.replace(/(\[\d*\]|_?\d+)$/, "") : name;
        return groupForKey(`${kind}|${form}|${base}`);
      }
    }
    const p = el.parentElement || el;
    const li = p.closest("li");
    const container =
      p.closest("[role=radiogroup], [role=listbox], [role=group], [role=menu], fieldset") ||
      p.closest(".que, .question, [data-question-id], [class*=question]") ||
      (li && li.parentElement) ||
      p.closest("form") ||
      p;
    return groupForEl(container);
  }

  function textOfIds(doc, ids) {
    return ids
      .split(/\s+/)
      .map((id) => {
        const n = doc.getElementById(id);
        return n ? plainText(n) : "";
      })
      .join(" ");
  }

  /* textContent, but with rendered formulas read once as TeX (the way the page text reads them)
     instead of their visual glyphs, assistive MathML and source all run together. */
  const MATH_PARTS = "mjx-container, .MathJax, .MathJax_Preview, .MathJax_Display, .MathJax_SVG, .MathJax_CHTML, .katex, math, script";
  function plainText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    if (!node.querySelector(MATH_PARTS) && !node.matches(MATH_PARTS)) return node.textContent;
    const tag = node.localName;
    const cls = node.classList;
    if (tag === "script") return /math\/tex/i.test(node.getAttribute("type") || "") ? ` $${node.textContent.trim()}$ ` : "";
    // MathJax 3 also gives its container the MathJax class, so it has to be read before that class is skipped.
    if (tag === "mjx-container") {
      const math = node.querySelector("math");
      const t = math ? mathElementText(math) : node.getAttribute("aria-label") || "";
      return t ? ` $${t}$ ` : "";
    }
    if (cls.contains("MathJax_Preview") || cls.contains("MathJax") || cls.contains("MathJax_Display") || cls.contains("MathJax_SVG") || cls.contains("MathJax_CHTML")) return "";
    if (cls.contains("katex")) {
      const ann = node.querySelector('annotation[encoding="application/x-tex"]');
      if (ann) return ` $${ann.textContent.trim()}$ `;
    }
    if (tag === "math") return ` $${mathElementText(node)}$ `;
    return [...node.childNodes].map(plainText).join("");
  }

  /* An unlabelled radio or checkbox in a table cell (true/false grids, Likert scales): name it
     after its row's text and its column's heading. */
  function tableLabel(el) {
    const td = el.closest("td, th");
    const tr = td && td.parentElement;
    const table = tr && tr.closest("table");
    if (!table) return "";
    const rowText = GR.clean([...tr.cells].filter((c) => !c.querySelector("input, select, textarea")).map(plainText).join(" "));
    const head = table.tHead ? table.tHead.rows[0] : table.rows[0] !== tr ? table.rows[0] : null;
    const col = head && head.cells[td.cellIndex];
    const colText = col && col !== td ? GR.clean(plainText(col)) : "";
    return GR.clean([rowText, colText].filter(Boolean).join(" → "));
  }

  /* Adapters can tidy labels (Moodle appends " Question 3" to every one for screen readers). */
  function labelText(el, opts) {
    const t = rawLabelText(el, opts);
    return GR.labelFilter ? GR.labelFilter(el, t) : t;
  }

  function rawLabelText(el, { fromOwnText = false } = {}) {
    const doc = el.ownerDocument;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = GR.clean(textOfIds(doc, by));
      if (t) return GR.clip(t, 120);
    }
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return GR.clip(aria, 120);
    if (el.labels && el.labels.length) {
      const t = GR.clean([...el.labels].map(plainText).join(" "));
      if (t) return GR.clip(t, 120);
    }
    if (el.type === "radio" || el.type === "checkbox") {
      let s = el.nextSibling;
      while (s && !GR.clean(plainText(s))) s = s.nextSibling;
      if (s && GR.clean(plainText(s))) return GR.clip(plainText(s), 120);
      const wrap = el.closest("label, li, td, [role=listitem]");
      if (wrap && GR.clean(plainText(wrap))) return GR.clip(plainText(wrap), 120);
      const cell = tableLabel(el);
      if (cell) return GR.clip(cell, 120);
    }
    if (fromOwnText) return GR.clip(el.textContent, 120);
    return GR.clip(el.getAttribute("placeholder") || el.getAttribute("title") || "", 120);
  }

  function q(s) {
    return JSON.stringify(GR.clip(s, 120));
  }

  function isSiteSearch(el) {
    const t = (el.getAttribute("type") || "").toLowerCase();
    if (t === "search") return true;
    if (el.closest("[role=search], form[action*=search i]")) return true;
    const hint = `${el.name || ""} ${el.id || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`;
    return /^\s*(q|s|query)\s*$/i.test(el.name || "") || /\bsearch\b|\bsuche\b/i.test(hint);
  }

  function isEditingHost(el) {
    if (!el.isContentEditable) return false;
    const parent = el.parentElement;
    return !parent || !parent.isContentEditable;
  }

  /* ---------- MathML to linear text ---------- */

  function mathToText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    const tag = node.localName;
    const kids = [...node.children];
    const sub = (i) => mathToText(kids[i]);
    const wrap = (s) => (GR.clean(s).length > 1 ? `(${GR.clean(s)})` : GR.clean(s));
    if (tag === "annotation" || tag === "annotation-xml") return "";
    if (tag === "semantics") return mathToText(kids[0]);
    if (tag === "mfrac") return `${wrap(sub(0))}/${wrap(sub(1))}`;
    if (tag === "msup") return `${wrap(sub(0))}^${wrap(sub(1))}`;
    if (tag === "msub") return `${wrap(sub(0))}_${wrap(sub(1))}`;
    if (tag === "msubsup") return `${wrap(sub(0))}_${wrap(sub(1))}^${wrap(sub(2))}`;
    if (tag === "msqrt") return `sqrt(${kids.map(mathToText).join("")})`;
    if (tag === "mroot") return `root(${GR.clean(sub(1))}, ${GR.clean(sub(0))})`;
    if (tag === "munderover") return `${sub(0)}_${wrap(sub(1))}^${wrap(sub(2))}`;
    if (tag === "munder") return `${sub(0)}_${wrap(sub(1))}`;
    if (tag === "mover") return `${sub(0)}^${wrap(sub(1))}`;
    if (tag === "mtable") return kids.map((r) => "[" + [...r.children].map(mathToText).join(", ") + "]").join("; ");
    if (tag === "mo") return ` ${node.textContent.trim()} `;
    if (kids.length) return kids.map(mathToText).join("");
    return node.textContent;
  }

  function mathElementText(math) {
    const tex = math.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="TeX"]');
    if (tex && tex.textContent.trim()) return tex.textContent.trim();
    const alt = math.getAttribute("alttext");
    if (alt) return alt.trim();
    return GR.clean(mathToText(math));
  }

  /* ---------- The walk ---------- */

  function emit(ctx, s) {
    ctx.out.push(s);
    ctx.len += s.length;
  }

  function register(ctx, el, kind, extra) {
    const id = idFor(el);
    const field = Object.assign({ id, el, kind }, extra || {});
    reg.byId.set(id, field);
    ctx.fields.push(field);
    return field;
  }

  /* Returns the image number, or 0 when the image is skipped. `quiet` leaves the
     marker to the caller; `overlay` draws on the image before it is sent. */
  function addImage(ctx, el, minSize, opts = {}) {
    const r = el.getBoundingClientRect();
    const alt = GR.clip(el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "", 140);
    if (r.width < minSize || r.height < minSize) {
      if (alt && !opts.quiet) emit(ctx, ` [${alt}] `);
      return 0;
    }
    if (ctx.images.length >= ctx.maxImages && !opts.force) {
      if (!opts.quiet) emit(ctx, alt ? ` [image: ${alt}] ` : " [image] ");
      return 0;
    }
    const n = ctx.images.length + 1;
    ctx.images.push({ n, el, alt, overlay: opts.overlay || null });
    if (!opts.quiet) emit(ctx, ` {{IMG ${n}${alt ? ` alt=${q(alt)}` : ""}}} `);
    return n;
  }

  /* Pictures that carry no question content: hidden from screen readers, marked as presentation,
     part of the site's navigation or banner, or small unlabelled icons. Each image costs tokens. */
  function decorative(el) {
    if (el.closest('[aria-hidden="true"], nav, [role=navigation], [role=banner]')) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "presentation" || role === "none") return true;
    const labelled = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || (el.localName === "svg" && el.querySelector("title"));
    const r = el.getBoundingClientRect();
    return !labelled && r.width < 48 && r.height < 48;
  }

  const ANSWERABLE = "input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]):not([type=image]), select, textarea, [contenteditable=''], [contenteditable=true], [role=radio], [role=checkbox], [role=option], [role=combobox], [role=textbox]";
  function isChrome(el, tag) {
    if (tag === "nav" || tag === "footer") return true;
    const role = el.getAttribute("role");
    return role === "navigation" || role === "contentinfo";
  }

  function walkChildren(parent, ctx) {
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (ctx.len > ctx.hardLimit) return;
      walk(n, ctx);
    }
  }

  function walk(node, ctx) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      if (!t) return;
      if (t.trim()) emit(ctx, t.replace(/\s+/g, " "));
      else emit(ctx, " ");
      return;
    }
    if (node.nodeType === 11) return walkChildren(node, ctx);
    if (node.nodeType !== 1) return;

    const el = node;
    const tag = el.localName;
    if (el === GR.hostEl || el.id === "guteayri-hud-host") return;

    if (tag === "script") {
      const type = el.getAttribute("type") || "";
      if (/math\/tex/i.test(type)) emit(ctx, ` $${el.textContent.trim()}$ `);
      return;
    }
    if (SKIP_TAGS.has(tag)) return;

    // Math renderers: emit TeX once and skip their visual markup. MathJax 3's container carries the
    // MathJax class too, so it is read before MathJax 2's rendered copies are skipped.
    if (tag === "mjx-container") {
      const math = el.querySelector("math");
      const t = math ? mathElementText(math) : el.getAttribute("aria-label") || "";
      if (t) return emit(ctx, ` $${t}$ `);
    }
    if (el.classList && (el.classList.contains("MathJax_Preview") || el.classList.contains("MathJax") ||
        el.classList.contains("MathJax_Display") || el.classList.contains("MathJax_SVG") || el.classList.contains("MathJax_CHTML"))) {
      return;
    }
    if (el.classList && el.classList.contains("katex")) {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      if (ann) return emit(ctx, ` $${ann.textContent.trim()}$ `);
    }
    if (tag === "math") return emit(ctx, ` $${mathElementText(el)}$ `);

    const isInput = tag === "input";
    const inputType = isInput ? (el.getAttribute("type") || "text").toLowerCase() : "";
    const isChoiceInput = isInput && (inputType === "radio" || inputType === "checkbox");

    // Styled radios and checkboxes are often hidden behind their label but still work.
    // Adapters can keep other hidden fields that store the real answer (e.g. drag-and-drop selects).
    if (!isChoiceInput && !GR.visible(el) && !(GR.keepHidden && GR.keepHidden(el))) return;

    // Site menus and footers with nothing to answer in them: their text only costs tokens.
    if (isChrome(el, tag) && !el.querySelector(ANSWERABLE)) return;

    for (const special of GR.specials) {
      if (special(el, tag, ctx)) return;
    }

    if (tag === "br") return emit(ctx, "\n");
    const block = BLOCK_TAGS.has(tag);
    if (block) emit(ctx, "\n");

    if (isInput) {
      handleInput(el, inputType, ctx);
    } else if (tag === "textarea") {
      handleTextLike(el, ctx, "textarea");
    } else if (tag === "select") {
      handleSelect(el, ctx);
    } else if (tag === "img") {
      if (!decorative(el)) addImage(ctx, el, 32);
    } else if (tag === "svg") {
      if (!decorative(el)) addImage(ctx, el, 56);
    } else if (tag === "canvas") {
      addImage(ctx, el, 56);
    } else if (tag === "video") {
      emit(ctx, " [video] ");
    } else if (tag === "iframe" || tag === "frame") {
      handleFrame(el, ctx);
    } else if (isEditingHost(el)) {
      const current = GR.clip(el.innerText || el.textContent, 200);
      const f = register(ctx, el, "editable", { label: labelText(el) });
      emit(ctx, ` {{#${f.id} editor${f.label ? " " + q(f.label) : ""}${current ? ` value=${q(current)}` : ""}}} `);
    } else {
      handleGeneric(el, tag, ctx);
    }

    if (tag === "td" || tag === "th") emit(ctx, " | ");
    if (block) emit(ctx, "\n");
  }

  function handleInput(el, type, ctx) {
    if (NO_FIELD_INPUTS.has(type)) return;
    if (type === "radio" || type === "checkbox") {
      const vis = GR.visible(el) || (el.labels && [...el.labels].some(GR.visible)) || (el.parentElement && GR.visible(el.parentElement));
      if (!vis || el.disabled) return;
      const label = labelText(el);
      const f = register(ctx, el, type, { group: choiceGroup(el, type), label });
      emit(ctx, ` {{#${f.id} ${type} g${f.group}${label ? " " + q(label) : ""}${el.checked ? " checked" : ""}}} `);
      return;
    }
    handleTextLike(el, ctx, type || "text");
  }

  function handleTextLike(el, ctx, type) {
    const value = el.value || "";
    if (el.disabled || (el.readOnly && !(GR.allowReadonly && GR.allowReadonly(el)))) {
      if (value) emit(ctx, ` ${GR.clip(value, 200)} `);
      return;
    }
    if (type !== "textarea" && isSiteSearch(el)) return;
    if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "")) return;
    const label = labelText(el);
    const role = (el.getAttribute("role") || "").toLowerCase();
    const isCombo = role === "combobox" || !!el.getAttribute("aria-autocomplete") || (el.list && el.list.options && el.list.options.length > 0);
    const kind = type === "textarea" ? "textarea" : isCombo ? "combo" : "text";
    const f = register(ctx, el, kind, { inputType: type, label });
    const desc = kind === "combo" ? "combobox" : type === "text" ? "text" : type;
    let extra = "";
    if (el.list && el.list.options && el.list.options.length) {
      extra += ` options=[${[...el.list.options].slice(0, 40).map((o) => q(o.value || o.textContent)).join(",")}]`;
    }
    const ph = el.getAttribute("placeholder");
    if (ph && ph !== label) extra += ` placeholder=${q(ph)}`;
    if (el.maxLength > 0 && el.maxLength < 10000) extra += ` maxlength=${el.maxLength}`;
    if (type === "number" || type === "range") {
      if (el.min) extra += ` min=${el.min}`;
      if (el.max) extra += ` max=${el.max}`;
      if (el.step && el.step !== "any") extra += ` step=${el.step}`;
    }
    if (GR.fieldHint) extra += GR.fieldHint(el);
    if (value) extra += ` value=${q(value)}`;
    emit(ctx, ` {{#${f.id} ${desc}${label ? " " + q(label) : ""}${extra}}} `);
  }

  function handleSelect(el, ctx) {
    if (el.disabled) return;
    const options = [...el.options].slice(0, 80).map((o) => GR.clip(o.text, 80));
    const selected = [...el.selectedOptions].map((o) => GR.clip(o.text, 80));
    const label = labelText(el);
    const f = register(ctx, el, "select", { label, multiple: el.multiple });
    const sel = el.multiple ? (selected.length ? `[${selected.map(q).join(",")}]` : "") : selected[0] ? q(selected[0]) : "";
    emit(ctx, ` {{#${f.id} select${el.multiple ? " multiple" : ""}${label ? " " + q(label) : ""} options=[${options.map(q).join(",")}]${sel ? ` selected=${sel}` : ""}}} `);
  }

  function handleFrame(el, ctx) {
    let doc = null;
    try {
      doc = el.contentDocument;
    } catch (e) {
      doc = null;
    }
    if (doc && (doc.body || doc.documentElement)) {
      GR.ensurePageStyle(doc);
      emit(ctx, "\n");
      walk(doc.body || doc.documentElement, ctx);
      emit(ctx, "\n");
    }
    // Cross-origin frames scan themselves and report to the panel.
    else {
      const r = el.getBoundingClientRect();
      if (r.width >= 200 && r.height >= 120) ctx.remoteFrames++;
    }
  }

  function handleGeneric(el, tag, ctx) {
    const role = (el.getAttribute("role") || "").toLowerCase();
    let kind = null;
    if (role === "radio" || role === "menuitemradio") kind = "aria-radio";
    else if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox") kind = "aria-checkbox";
    else if (role === "option" && el.closest("[role=listbox]")) kind = "option";
    else if (role === "combobox" || (role === "button" && el.getAttribute("aria-haspopup") === "listbox")) kind = "combo";
    else if ((tag === "button" || role === "button") && ctx.clickButtons) kind = "button";

    // A widget wrapping a native input is handled through that input.
    if (kind && kind !== "combo" && el.querySelector("input[type=radio], input[type=checkbox], select, textarea, input:not([type])")) kind = null;

    if (kind === "button") {
      const text = GR.clean(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (!text || text.length > 160 || type === "submit" || BUTTON_DENY.test(text) || el.disabled || el.closest("nav, header, [role=navigation], [role=toolbar], [role=menubar]") ||
          (GR.buttonDeny && el.closest(GR.buttonDeny))) kind = null;
    }

    const shadow = el.openOrClosedShadowRoot || el.shadowRoot;

    if (!kind) {
      if (tag === "slot") {
        const assigned = el.assignedNodes ? el.assignedNodes({ flatten: true }) : [];
        if (assigned.length) return assigned.forEach((n) => walk(n, ctx));
      }
      return walkChildren(shadow || el, ctx);
    }

    if (kind === "combo") {
      const label = labelText(el, { fromOwnText: false });
      const current = GR.clip(el.innerText || el.textContent, 80);
      const f = register(ctx, el, "combo", { label });
      emit(ctx, ` {{#${f.id} combobox${label ? " " + q(label) : ""}${current ? ` value=${q(current)}` : ""}}} `);
      return;
    }

    const state =
      el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true";
    const explicit = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    const label = explicit ? labelText(el) : "";
    const f = register(ctx, el, kind, { group: choiceGroup(el, kind), label: label || GR.clip(el.innerText || el.textContent, 120) });
    const desc = kind === "aria-checkbox" ? "checkbox" : kind === "button" ? "button" : "choice";
    emit(ctx, ` {{#${f.id} ${desc}${kind === "button" ? "" : " g" + f.group}${label ? " " + q(label) : ""}${state ? (kind === "aria-checkbox" ? " checked" : " selected") : ""}}} `);
    walkChildren(shadow || el, ctx);
  }

  /* ---------- Trimming ---------- */

  /* A choice's label is already inside its marker ({{#3 radio g1 "Paris"}}), so the same words
     straight after it are dropped. Only an exact, whole-word repeat goes; anything else stays. */
  const CHOICE_MARK = /\{\{#\d+ (?:radio|checkbox|choice) g\d+ ("(?:[^"\\]|\\.)*")[^}]*\}\}/g;
  /* A select with the same option list as the select before it in the same question (matching
     rows, drag-and-drop blanks, ordering positions) says options=same instead of repeating it. */
  function shareRepeatedOptions(text) {
    let prev = null;
    return text.replace(/\n### |\{\{#\d+ select[^\n]*?options=(\[(?:"(?:[^"\\]|\\.)*",?)*\])/g, (m, opts) => {
      if (!opts) { prev = null; return m; } // a new question starts
      if (opts === prev && opts.length > 12) return m.slice(0, m.length - opts.length) + "same";
      prev = opts;
      return m;
    });
  }

  /* A field's label that only repeats the words just before it ("Answer: {{#5 text "Answer:"}}") is dropped. */
  function dropLeadingLabels(text) {
    return text.replace(/\{\{#(\d+) (text|textarea|select|combobox|editor) ("(?:[^"\\]|\\.)*")/g, (m, id, kind, quoted, offset) => {
      let label = "";
      try { label = JSON.parse(quoted); } catch (e) { return m; }
      const before = GR.clean(text.slice(Math.max(0, offset - label.length - 40), offset));
      return label && before.endsWith(GR.clean(label)) ? `{{#${id} ${kind}` : m;
    });
  }

  function dropEchoedLabels(text) {
    let out = "", last = 0, m;
    CHOICE_MARK.lastIndex = 0;
    while ((m = CHOICE_MARK.exec(text))) {
      let label = "";
      try { label = JSON.parse(m[1]); } catch (e) { continue; }
      if (!label || label.endsWith("…")) continue; // clipped labels aren't the whole text
      const words = label.split(/\s+/).filter(Boolean);
      let i = CHOICE_MARK.lastIndex, ok = words.length > 0;
      for (const w of words) {
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text.startsWith(w, i)) i += w.length;
        else { ok = false; break; }
      }
      if (!ok || (i < text.length && !/\s/.test(text[i]) && !text.startsWith("{{", i))) continue;
      out += text.slice(last, CHOICE_MARK.lastIndex);
      last = i;
    }
    return out + text.slice(last);
  }

  function tidy(text) {
    return text
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/( \| ){2,}/g, " | ")
      .replace(/\n{3,}/g, "\n\n")
      // Consecutive fields (a list of options) on consecutive lines, without blank lines between them.
      .replace(/\}\}\n\n(?=\{\{#)/g, "}}\n")
      .trim();
  }

  /* Over budget: keep the opening lines, every line with a field or image, and
     a window of context around each of them. */
  function fitBudget(text, max) {
    if (text.length <= max) return text;
    const lines = text.split("\n");
    const keep = new Uint8Array(lines.length);
    for (let i = 0; i < Math.min(30, lines.length); i++) keep[i] = 1;
    lines.forEach((l, i) => {
      if (/\{\{(#\d+|IMG \d+)/.test(l)) {
        for (let j = Math.max(0, i - 10); j <= Math.min(lines.length - 1, i + 3); j++) keep[j] = 1;
      }
    });
    const out = [];
    let skipped = false;
    lines.forEach((l, i) => {
      if (keep[i]) {
        out.push(l);
        skipped = false;
      } else if (!skipped) {
        out.push("…");
        skipped = true;
      }
    });
    let t = out.join("\n");
    if (t.length > max) t = t.slice(0, max) + "\n…(page truncated)";
    return t;
  }

  GR.scanApi = { emit, register, addImage, walk, walkChildren, labelText, quote: q, idFor };

  GR.scan = function scan(opts = {}) {
    const ctx = {
      out: [],
      len: 0,
      fields: [],
      images: [],
      remoteFrames: 0,
      maxImages: opts.maxImages ?? 12,
      clickButtons: opts.clickButtons !== false,
      hardLimit: (opts.maxChars || 60000) * 6,
    };
    GR.ensurePageStyle(document);
    walk(document.body || document.documentElement, ctx);
    const text = fitBudget(tidy(shareRepeatedOptions(dropLeadingLabels(dropEchoedLabels(tidy(ctx.out.join("")))))), opts.maxChars || 60000);
    return { text, fields: ctx.fields, images: ctx.images, remoteFrames: ctx.remoteFrames };
  };

  GR.fieldById = (id) => {
    const f = reg.byId.get(id);
    return f && f.el && f.el.isConnected ? f : null;
  };

  GR.groupMembers = (group) => {
    const out = [];
    for (const f of reg.byId.values()) if (f.group === group && f.el.isConnected) out.push(f);
    return out.sort((a, b) => a.id - b.id);
  };
})();
