/* GuteAyri — NetAcad adapter (Cisco Networking Academy and Skills for All assessments).
   The assessment player runs in a same-origin iframe ("Course content"). It keeps every visited question
   in the page, inside nested open shadow roots, and shows one at a time: the block-view with tabindex="0".
   GuteAyri reads only that question, so answered questions and the course menu around them are left
   alone and cost no tokens.
   Question types with their own widgets:
     matching-view        one dropdown per item, its options inside the dropdown's shadow root
     object-matching-view click a category on the left, then the option on the right that belongs to it
     mcq-view             the row is the control (role radio or checkbox); its input is hidden and only follows
   Never touches Submit, Skip or the question strip. */
(() => {
  const GR = globalThis.GR;
  if (!GR || GR.netacadLoaded) return;
  GR.netacadLoaded = true;

  const PLAYER_HOSTS = /(^|\.)(netacad\.com|skillsforall\.com)$/i;
  const onPlayer = () => PLAYER_HOSTS.test(location.hostname);
  const PLAYER = onPlayer();

  const DENY = ".block-button, .article__btn-arrow, .abs__skip-button, .abs__btn-arrow, .nav__skip-btn, .nav_btn";
  GR.buttonDeny = GR.buttonDeny ? `${GR.buttonDeny}, ${DENY}` : DENY;

  const shadowOf = (el) => el.openOrClosedShadowRoot || el.shadowRoot;
  /* An element's text without the notes for screen readers ("1 of 6"). */
  function textOf(el) {
    if (!el) return "";
    const copy = el.cloneNode(true);
    copy.querySelectorAll(".screenReader-position-text, .sr-only, .aria-label").forEach((n) => n.remove());
    return GR.clean(copy.textContent);
  }

  /* ---------- The question on screen ---------- */

  /* Every shadow root (or document) that holds block-views, through shadow roots and same-origin frames.
     Blocks can sit in more than one article. */
  function collectBlockRoots(root, out, depth) {
    if (root.querySelector("block-view")) out.add(root);
    if (depth >= 16) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.localName === "block-view") continue;
      const inner = shadowOf(el);
      if (inner) collectBlockRoots(inner, out, depth + 1);
      if (el.localName !== "iframe") continue;
      let doc = null;
      try { doc = el.contentDocument; } catch (e) { /* another origin: not the player */ }
      if (doc) collectBlockRoots(doc, out, depth + 1);
    }
  }

  let blockRoots = new Set();

  function freshBlockRoots() {
    blockRoots = new Set();
    collectBlockRoots(document, blockRoots, 0);
    return blockRoots;
  }

  /* True when a block has a question in it, at any depth (the start screen and results blocks don't). */
  function holdsQuestion(root, depth = 0) {
    if (root.querySelector(".component.is-question")) return true;
    if (depth >= 8) return false;
    for (const el of root.querySelectorAll("*")) {
      const inner = shadowOf(el);
      if (inner && holdsQuestion(inner, depth + 1)) return true;
    }
    return false;
  }

  function activeIn(roots) {
    for (const root of roots) {
      if (root.host ? !root.host.isConnected : !root.defaultView) continue;
      const block = root.querySelector('block-view[tabindex="0"]');
      if (block && shadowOf(block) && holdsQuestion(shadowOf(block))) return block;
    }
    return null;
  }

  function activeBlock() {
    if (!onPlayer()) return null;
    return activeIn(blockRoots) || activeIn(freshBlockRoots());
  }

  function blockKey(block) {
    const inner = shadowOf(block);
    const tagged = inner && inner.querySelector("[data-socialgoodpulse-id]");
    return tagged ? tagged.getAttribute("data-socialgoodpulse-id") : "";
  }

  /* Questions already read, so auto mode doesn't answer one twice when the person goes back to it. */
  const handled = new Set();

  /* ---------- Choosing from a list of answers ---------- */

  /* The entry a model answer names: exact text, then the letter, then a prefix, then containment. */
  function pick(list, value) {
    const raw = Array.isArray(value) ? value[0] : value;
    const want = GR.norm(String(raw ?? ""));
    if (!want) return null;
    const norm = (o) => GR.norm(o.text);
    return list.find((o) => norm(o) === want)
      || list.find((o) => o.letter && GR.norm(o.letter) === want)
      || list.find((o) => norm(o).startsWith(want) || want.startsWith(norm(o)))
      || list.find((o) => norm(o).includes(want) || want.includes(norm(o)))
      || null;
  }

  /* ---------- Multiple choice ---------- */

  const rowOn = (row) => row.getAttribute("aria-checked") === "true";

  /* Clicks a row the way a person does and waits for the player to record it: the label first, then the
     keyboard, then the hidden input. Only a change in aria-checked counts. */
  async function pressRow(row) {
    const before = rowOn(row);
    const changed = () => rowOn(row) !== before;
    GR.realClick(row.querySelector("label") || row);
    if (await GR.waitFor(changed, 500, 25)) return true;
    await GR.pressKey(row, " ", "Space", 32);
    if (await GR.waitFor(changed, 400, 25)) return true;
    const input = row.querySelector("input");
    if (input) input.click();
    return GR.waitFor(changed, 400, 25);
  }

  GR.CHOICE_KINDS.add("netacad-choice");

  GR.fillers["netacad-choice"] = async (field, value) => {
    const row = field.el;
    const want = GR.toBool(value);
    if (field.single && !want) return { ok: true, skipped: true };
    if (rowOn(row) === want) return { ok: true };
    const siblings = GR.groupMembers(field.group).map((m) => m.el);
    const prev = field.single ? siblings.find((r) => r !== row && rowOn(r)) : null;
    if (!(await pressRow(row))) return { ok: false, reason: "the option didn't take the click" };
    const undo = field.single ? (prev ? async () => { await pressRow(prev); } : undefined) : async () => { await pressRow(row); };
    return { ok: true, undo };
  };

  function emitChoice(row, ctx) {
    const input = row.querySelector("input");
    const single = row.getAttribute("role") === "radio" || (!!input && input.type === "radio");
    const inner = row.querySelector(".mcq__item-text-inner") || row.querySelector(".mcq__item-text") || row.querySelector("label");
    const pictures = [...row.querySelectorAll("img")];
    const text = textOf(inner) || GR.clean(pictures.map((p) => p.getAttribute("alt") || "").join(" "));
    // After submitting, the rows are read-only: show the text but offer no field.
    if ((input && input.disabled) || row.getAttribute("aria-disabled") === "true") {
      GR.scanApi.emit(ctx, `\n${text}\n`);
      return true;
    }
    const component = row.closest(".component");
    const key = (component && component.getAttribute("data-socialgoodpulse-id")) || (row.getAttribute("aria-labelledby") || "").replace(/-\d+-label$/, "");
    const group = GR.scanApi.groupForKey(`netacad|${key}`);
    const f = GR.scanApi.register(ctx, row, "netacad-choice", { group, single, label: text });
    GR.scanApi.emit(ctx, `\n{{#${f.id} ${single ? "radio" : "checkbox"} g${group} ${GR.scanApi.quote(text)}${rowOn(row) ? (single ? " selected" : " checked") : ""}}}`);
    for (const p of pictures) GR.scanApi.addImage(ctx, p, 16);
    GR.scanApi.emit(ctx, "\n");
    return true;
  }

  /* ---------- Matching with dropdowns ---------- */

  function dropdownParts(host) {
    const root = shadowOf(host);
    if (!root) return null;
    const button = root.querySelector(".js-dropdown-btn, button.dropdown__btn");
    const list = root.querySelector("[role=listbox]");
    if (!button || !list) return null;
    const stem = root.querySelector(".matching__item-title .matching__item-title_inner") || root.querySelector(".matching__item-title");
    const options = [...list.querySelectorAll("[role=option]")].map((li) => {
      const inner = li.querySelector(".js-dropdown-list-item-inner") || li;
      // The value attribute is the option alone; its text also has "1 of 3, not selected" for screen readers.
      return { li, inner, text: GR.clean(inner.getAttribute("value") || inner.textContent) };
    });
    const shown = textOf(root.querySelector(".js-dropdown-inner"));
    const marked = options.find((o) => o.li.getAttribute("aria-selected") === "true");
    const selected = (options.find((o) => o.text === shown) || marked || { text: "" }).text;
    return { button, options, stem: textOf(stem), selected };
  }

  async function chooseOption(host, text) {
    const parts = () => dropdownParts(host);
    const isOpen = () => {
      const p = parts();
      return !!p && p.button.getAttribute("aria-expanded") === "true";
    };
    const chosen = () => {
      const p = parts();
      return !!p && p.selected === text;
    };
    const item = () => {
      const p = parts();
      return p && p.options.find((o) => o.text === text);
    };
    if (!isOpen()) {
      GR.realClick(parts().button);
      await GR.waitFor(isOpen, 1500, 30);
    }
    if (!item()) return false;
    GR.realClick(item().inner);
    if (await GR.waitFor(chosen, 1200, 30)) return true;
    // The list also takes Enter on the focused option, for keyboard users.
    if (item()) await GR.pressKey(item().inner, "Enter", "Enter", 13);
    return GR.waitFor(chosen, 800, 30);
  }

  GR.fillers["netacad-dropdown"] = async (field, value) => {
    const d = dropdownParts(field.host);
    if (!d) return { ok: false, reason: "the dropdown is no longer on the page" };
    const choice = pick(d.options, value);
    if (!choice) return { ok: false, reason: `"${value}" is not one of the options` };
    const prev = d.selected;
    if (prev === choice.text) return { ok: true };
    if (!(await chooseOption(field.host, choice.text))) return { ok: false, reason: "the dropdown didn't take the answer" };
    // There's no way back to "Please select an option", so undo only restores an earlier choice.
    return { ok: true, undo: prev ? async () => { await chooseOption(field.host, prev); } : undefined };
  };

  /* ---------- Matching by clicking a category, then an option ---------- */

  function matchingParts(host) {
    const root = shadowOf(host);
    const widget = root && root.querySelector(".objectMatching__widget");
    if (!widget) return null;
    const categories = [...widget.querySelectorAll("button.objectMatching-category-item")].map((button) => ({
      button,
      text: textOf(button.querySelector(".category-item-text")),
      letter: textOf(button.querySelector(".category-item-number")),
    }));
    const options = [...widget.querySelectorAll("button.objectMatching-option-item")].map((button) => ({
      button,
      text: textOf(button.querySelector(".category-item-text")),
      // Shows the category's letter once the option is connected.
      assigned: textOf(button.querySelector(".category-item-number")),
    }));
    return categories.length && options.length ? { categories, options } : null;
  }

  GR.fillers["netacad-match"] = async (field, value) => {
    const read = () => matchingParts(field.host);
    const first = read();
    const option = first && first.options[field.index];
    if (!option) return { ok: false, reason: "the question is no longer on the page" };
    const category = pick(first.categories, value);
    if (!category) return { ok: false, reason: `"${value}" is not one of the categories` };
    if (category.letter && option.assigned === category.letter) return { ok: true };
    const before = option.button.outerHTML;
    GR.realClick(category.button);
    await GR.sleep(90);
    const now = read();
    if (!now || !now.options[field.index]) return { ok: false, reason: "the question changed while filling" };
    GR.realClick(now.options[field.index].button);
    const connected = () => {
      const o = (read() || { options: [] }).options[field.index];
      return !!o && !!category.letter && o.assigned === category.letter;
    };
    if (await GR.waitFor(connected, 1200, 30)) return { ok: true };
    // If the letter doesn't show, any change on the option still means the click connected it.
    const after = (read() || { options: [] }).options[field.index];
    if (after && after.button.outerHTML !== before) return { ok: true };
    return { ok: false, reason: "the option didn't connect to the category" };
  };

  /* ---------- Scanner hooks ---------- */

  function emitDropdown(el, ctx) {
    const d = dropdownParts(el);
    if (!d || !d.options.length) return false;
    const f = GR.scanApi.register(ctx, d.button, "netacad-dropdown", { host: el, label: d.stem });
    const opts = d.options.map((o) => GR.scanApi.quote(o.text)).join(",");
    const current = d.selected ? ` selected=${GR.scanApi.quote(d.selected)}` : "";
    GR.scanApi.emit(ctx, `\n${d.stem}: {{#${f.id} select options=[${opts}]${current}}}\n`);
    return true;
  }

  function emitMatching(el, ctx) {
    const host = el.getRootNode().host;
    const m = host && matchingParts(host);
    if (!m) return false;
    const names = m.categories.map((c) => GR.scanApi.quote(c.text)).join(",");
    const byLetter = (letter) => m.categories.find((c) => c.letter && c.letter === letter);
    GR.scanApi.emit(ctx, "\nChoose the category that belongs to each option:\n");
    m.options.forEach((o, index) => {
      const f = GR.scanApi.register(ctx, o.button, "netacad-match", { host, index, label: o.text });
      const current = byLetter(o.assigned);
      GR.scanApi.emit(ctx, `${o.text}: {{#${f.id} select options=[${names}]${current ? ` selected=${GR.scanApi.quote(current.text)}` : ""}}}\n`);
    });
    return true;
  }

  function netacadSpecial(el, tag, ctx) {
    if (!PLAYER) return false;

    // The page itself: read only the question on screen.
    if (tag === "body" && el === document.body && !ctx.netacadRead) {
      ctx.netacadRead = true;
      const block = activeBlock();
      if (!block) return false;
      ctx.netacadBlock = block;
      handled.add(blockKey(block));
      GR.scanApi.walk(block, ctx);
      if (ctx.fields.length) return true;
      // Nothing recognised in the block (a question type without a widget here): read the page the
      // ordinary way rather than come back empty, still leaving out the other questions.
      ctx.out.length = 0;
      ctx.len = 0;
      return false;
    }
    if (tag === "block-view" && ctx.netacadBlock && el !== ctx.netacadBlock) return true;

    if (tag === "matching-dropdown-view") return emitDropdown(el, ctx);
    if (el.classList && el.classList.contains("js-mcq-item")) return emitChoice(el, ctx);
    if (el.classList && el.classList.contains("objectMatching__widget")) return emitMatching(el, ctx);

    // Icon ligatures ("check_box_outline_blank"), repeated headings and screen-reader notes ("Incomplete", "1 of 6").
    if (tag === "material-icon" || tag === "heading-view") return true;
    if (el.classList && (el.classList.contains("accessibility-completion-indicator") || el.classList.contains("screenReader-position-text"))) return true;

    // The assessment's own controls, for pages read the ordinary way.
    if (tag === "assessment-toolbar-view" || tag === "assessment-block-strip-view") return true;
    if (tag === "input" && (el.id === "skip-question" || el.id === "skip-all-question")) return true;
    return false;
  }

  GR.specials.push(netacadSpecial);

  /* ---------- Auto mode ---------- */

  /* Moving to the next question changes attributes inside shadow roots, which the page-wide observer can't
     see, so auto mode asks here instead. Undefined means this isn't the assessment player. */
  GR.autoFresh = () => {
    if (!onPlayer()) return undefined;
    const block = activeIn(blockRoots) || activeBlock();
    if (!block) return blockRoots.size ? false : undefined;
    return !handled.has(blockKey(block));
  };

  /* Calls `poke` when a new question comes on screen; returns a function that stops watching. */
  GR.autoWatch = (poke) => {
    if (!onPlayer()) return null;
    const timer = setInterval(() => { if (GR.autoFresh() === true) poke(); }, 1500);
    return () => clearInterval(timer);
  };

  // A long exam is a long run of separate questions, and each is answered once.
  if (onPlayer()) GR.autoLimit = 500;
})();
