/* GuteAyri — Moodle adapter.
   Core question types: multichoice, truefalse, shortanswer, numerical (unit radios and selects),
   calculated, calculatedsimple, calculatedmulti, match, randomsamatch, gapselect, multianswer (Cloze),
   essay (TinyMCE, Atto, plain, monospaced), ddwtos, ddimageortext, ddmarker, ordering, description.
   Plugins: CodeRunner (Ace and other UIs), gapfill, wordselect, crossword, STACK, formulas.
   Drag-and-drop answers go through Moodle's own keyboard and mouse handlers, so the hidden
   inputs that get submitted and what the page shows always agree.
   Never touches navigation, finish, Check / Try again, flags or "Clear my choice". */
(() => {
  const GR = globalThis.GR;
  if (!GR || GR.moodleLoaded) return;
  GR.moodleLoaded = true;

  const KEY_SPACE = [" ", "Space", 32];
  const KEY_ESCAPE = ["Escape", "Escape", 27];

  /* Hidden elements that still carry a field: a ddwtos blank hides itself once a word sits in it,
     and CodeRunner hides its answer box behind the editor. */
  const baseKeepHidden = GR.keepHidden;
  GR.keepHidden = (el) => {
    if (baseKeepHidden && baseKeepHidden(el)) return true;
    if (!el.classList) return false;
    if (el.localName === "span" && el.classList.contains("drop") && el.closest(".que.ddwtos")) return true;
    return el.localName === "textarea" && el.classList.contains("coderunner-answer");
  };

  const DENY = [
    ".submitbtns", ".mod_quiz-next-nav", "#mod_quiz_navblock", ".qnbutton", ".questionflag", ".im-controls",
    ".qtype_multichoice_clearchoice", ".answer_reset_btn", "[name$='-precheck']", "[name$='-submit']",
    "[name$='-tryagain']", ".tox-editor-header", ".tox-statusbar", ".editor_atto_toolbar", ".filemanager",
  ].join(", ");
  GR.buttonDeny = GR.buttonDeny ? `${GR.buttonDeny}, ${DENY}` : DENY;

  /* Auto mode looks for new fields; drag-and-drop and ordering questions have none it would notice. */
  const AUTO = ".que.ddwtos span.drop, .que.ddimageortext .dropzone, .que.ddmarker .draghomes .marker, .que.ordering li.sortableitem";
  GR.autoCandidates = GR.autoCandidates ? `${GR.autoCandidates}, ${AUTO}` : AUTO;

  /* Noise inside a question: behaviour controls, feedback, history, the attachment picker. */
  const SKIP_IN_QUESTION = [
    "im-controls", "questionflag", "qtype_multichoice_clearchoice", "history", "comment", "outcome",
    "feedbacktrigger", "stackinputfeedback", "filemanager", "coderunner-test-results", "dd-original",
  ];

  /* ---------- Helpers ---------- */

  function choicesOf(container, group) {
    const map = new Map();
    for (const c of container.querySelectorAll(`.draghome.group${group}`)) {
      if (c.classList.contains("dragplaceholder")) continue;
      const num = GR.classNum(c, "choice");
      if (num == null || map.has(num)) continue;
      const text = GR.clean(c.innerText || c.textContent) || GR.clean(c.getAttribute("alt") || "");
      map.set(num, { choice: num, text: text || `Choice ${num}`, el: c });
    }
    return [...map.values()].sort((a, b) => a.choice - b.choice);
  }

  function choiceText(choices, value) {
    const c = choices.find((x) => String(x.choice) === String(value));
    return c ? c.text : "";
  }

  /* The option a model answer names: exact text, then prefix, then containment, then a 1-based number. */
  function pickChoice(choices, value) {
    const raw = String(Array.isArray(value) ? value[0] : value ?? "").trim();
    const w = GR.norm(raw);
    if (!w) return null;
    const scored = choices
      .map((c) => {
        const t = GR.norm(c.text);
        let s = 0;
        if (t === w) s = 100;
        else if (t.startsWith(w) || w.startsWith(t)) s = 70 - Math.abs(t.length - w.length) / 10;
        else if (t.includes(w) || w.includes(t)) s = 50 - Math.abs(t.length - w.length) / 10;
        return { c, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    if (scored.length) return scored[0].c;
    return /^\d+$/.test(raw) ? choices[Number(raw) - 1] || null : null;
  }

  function fireValue(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValue(el, value) {
    el.value = value;
    fireValue(el);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function textToHtml(text) {
    return String(text)
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  /* The same paragraphs as textToHtml, built as nodes for editing areas. */
  function textToNodes(doc, text) {
    return String(text)
      .split(/\n{2,}/)
      .map((para) => {
        const p = doc.createElement("p");
        para.split("\n").forEach((line, i) => {
          if (i) p.appendChild(doc.createElement("br"));
          p.appendChild(doc.createTextNode(line));
        });
        return p;
      });
  }

  function mouse(el, type, x, y) {
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1, view: GR.view(el) };
    el.dispatchEvent(new MouseEvent(type, init));
  }

  /* Moodle animates a drag for about 200 ms and ignores keys until it lands. */
  async function settle(q) {
    await GR.waitFor(() => !q.querySelector(".beingdragged"), 1500, 30);
    await GR.sleep(60);
  }

  /* ---------- Scanner hooks ---------- */

  function moodleSpecial(el, tag, ctx) {
    if (!el.classList) return false;

    // A quiz attempt: read only the answer form, never the page chrome around it.
    if (tag === "body" && el.id === "page-mod-quiz-attempt") {
      const form = el.ownerDocument.getElementById("responseform");
      if (!form) return false;
      GR.scanApi.walk(form, ctx);
      return true;
    }

    // TinyMCE: just the editing area, without menus, toolbars and the word-count button.
    if (el.classList.contains("tox-tinymce")) {
      for (const fr of el.querySelectorAll(".tox-edit-area iframe")) GR.scanApi.walk(fr, ctx);
      return true;
    }
    if (tag === "body" && el.id === "tinymce" && el.dataset.id) {
      const frame = GR.view(el).frameElement;
      const label = frame && frame.ownerDocument.querySelector(`label[for="${CSS.escape(el.dataset.id)}"]`);
      const current = GR.clip(el.innerText || el.textContent, 200);
      const text = label ? GR.clean(label.textContent) : "";
      const f = GR.scanApi.register(ctx, el, "editable", { label: GR.labelFilter ? GR.labelFilter(frame, text) : text });
      GR.scanApi.emit(ctx, ` {{#${f.id} editor${f.label ? " " + GR.scanApi.quote(f.label) : ""}${current ? ` value=${GR.scanApi.quote(current)}` : ""}}} `);
      return true;
    }

    if (el.classList.contains("ace_editor") && !el.closest(".ui_wrapper")) {
      const f = GR.scanApi.register(ctx, el, "ace", { label: "Code" });
      GR.scanApi.emit(ctx, ` {{#${f.id} textarea "Code"}} `);
      return true;
    }

    const q = el.closest(".que");
    if (!q) return false;

    for (const c of SKIP_IN_QUESTION) if (el.classList.contains(c)) return true;

    // Screen-reader-only text ("Question text", "Answer 1 Question 7"): fields carry it as their label.
    if ((el.classList.contains("accesshide") || el.classList.contains("sr-only") || el.classList.contains("visually-hidden")) &&
        !el.querySelector("input, select, textarea, [contenteditable]")) return true;

    // Question header: "### Question 3" instead of the state, mark and flag.
    if (el.classList.contains("info") && el.parentElement === q) {
      const no = el.querySelector(".no");
      const text = no ? GR.clean(no.innerText || no.textContent) : "";
      if (text) GR.scanApi.emit(ctx, `\n\n### ${text}\n`);
      return true;
    }

    // Shadow copies a plugin keeps in sync itself (Matrix keeps a hidden checkbox behind each radio).
    if (tag === "input" && el.getAttribute("aria-hidden") === "true" && (el.type === "checkbox" || el.type === "radio") && el.value !== "-1") return true;

    // The radio behind "Clear my choice" (multichoice) and STACK's empty radio option.
    if (tag === "input" && el.type === "radio" && (el.value === "-1" || (el.value === "" && q.classList.contains("stack")))) return true;

    const qc = q.classList;
    if (qc.contains("ddwtos")) return ddwtosSpecial(el, tag, ctx, q);
    if (qc.contains("ddimageortext")) return ddimageSpecial(el, tag, ctx, q);
    if (qc.contains("ddmarker")) return ddmarkerSpecial(el, tag, ctx, q);
    if (qc.contains("ordering")) return orderingSpecial(el, tag, ctx, q);
    if (qc.contains("match") || qc.contains("randomsamatch")) return matchSpecial(el, tag, ctx, q);
    if (qc.contains("coderunner")) return coderunnerSpecial(el, tag, ctx, q);
    if (qc.contains("crossword")) return crosswordSpecial(el, tag, ctx, q);
    if (qc.contains("wordselect")) return tag === "input" && el.classList.contains("selcheck");
    return false;
  }

  /* ddwtos: each blank becomes a select over the words of its group. */
  function ddwtosSpecial(el, tag, ctx, q) {
    if (q.classList.contains("qtype_ddwtos-readonly")) return false;
    if (el.classList.contains("draghome") || el.classList.contains("answercontainer")) return true;
    if (tag !== "span" || !el.classList.contains("drop")) return false;
    const place = GR.classNum(el, "place");
    const group = GR.classNum(el, "group") || 1;
    const input = place != null && q.querySelector(`input.placeinput.place${place}[name]`);
    if (!input) return false;
    const choices = choicesOf(q, group);
    const f = GR.scanApi.register(ctx, input, "moodle-dd", { place, group, choices, question: q, dropSelector: `span.drop.place${place}`, label: `Blank ${place}` });
    emitChoiceSelect(ctx, f, `Blank ${place}`, choices, input.value);
    return true;
  }

  function emitChoiceSelect(ctx, f, label, choices, value) {
    const opts = choices.map((c) => GR.scanApi.quote(c.text)).join(",");
    const current = choiceText(choices, value);
    GR.scanApi.emit(ctx, ` {{#${f.id} select ${GR.scanApi.quote(label)} options=[${opts}]${current ? ` selected=${GR.scanApi.quote(current)}` : ""}}} `);
  }

  /* ddimageortext: the background goes to the model with each drop zone numbered on it,
     and every zone is a select over its group's labels. */
  function ddimageSpecial(el, tag, ctx, q) {
    if (!el.classList.contains("ddarea")) return false;
    const img = el.querySelector("img.dropbackground");
    const inputs = [...el.querySelectorAll("input.placeinput[name]")];
    const readonly = q.classList.contains("qtype_ddimageortext-readonly");
    if (img) {
      const n = GR.scanApi.addImage(ctx, img, 16, {
        force: true,
        overlay: (g, w, h) => {
          const r = img.getBoundingClientRect();
          const kx = w / (r.width || w), ky = h / (r.height || h);
          for (const dz of el.querySelectorAll(".dropzones .dropzone")) {
            const z = dz.getBoundingClientRect();
            const place = GR.classNum(dz, "place");
            if (place == null || !z.width) continue;
            GR.drawTag(g, Math.round((z.left - r.left + z.width / 2) * kx), Math.round((z.top - r.top + z.height / 2) * ky), String(place), Math.max(11, Math.round(z.height * ky * 0.35)));
          }
        },
      });
      if (n) GR.scanApi.emit(ctx, `\n(Drop zones are numbered on Image ${n}.)`);
    }
    // Labels that are pictures go to the model as images too.
    const imageChoices = new Map();
    for (const d of el.querySelectorAll(".draghomes img.draghome:not(.dragplaceholder)")) {
      const num = GR.classNum(d, "choice"), group = GR.classNum(d, "group");
      const key = `${group}:${num}`;
      if (imageChoices.has(key) || GR.clean(d.getAttribute("alt") || "")) continue;
      const n = GR.scanApi.addImage(ctx, d, 1, { force: true, quiet: true });
      if (n) imageChoices.set(key, `Image ${n}`);
    }
    for (const input of inputs) {
      const place = GR.classNum(input, "place");
      const group = GR.classNum(input, "group") || 1;
      const choices = choicesOf(el, group).map((c) => (imageChoices.has(`${group}:${c.choice}`) ? Object.assign(c, { text: imageChoices.get(`${group}:${c.choice}`) }) : c));
      if (readonly) {
        GR.scanApi.emit(ctx, `\nDrop zone ${place}: ${choiceText(choices, input.value) || "(empty)"}`);
        continue;
      }
      const f = GR.scanApi.register(ctx, input, "moodle-dd", { place, group, choices, question: q, dropSelector: `.dropzones .dropzone.place${place}`, label: `Drop zone ${place}` });
      GR.scanApi.emit(ctx, `\nDrop zone ${place}:`);
      emitChoiceSelect(ctx, f, `Drop zone ${place}`, choices, input.value);
    }
    GR.scanApi.emit(ctx, "\n");
    return true;
  }

  /* ddmarker: a coordinate grid in the image's own pixels, and one x,y field per marker. */
  function ddmarkerSpecial(el, tag, ctx, q) {
    if (!el.classList.contains("ddarea")) return false;
    const img = el.querySelector("img.dropbackground");
    let n = 0;
    if (img) {
      n = GR.scanApi.addImage(ctx, img, 16, {
        force: true,
        overlay: (g, w, h) => {
          const nw = img.naturalWidth || w, nh = img.naturalHeight || h;
          const kx = w / nw, ky = h / nh;
          const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => Math.max(nw, nh) / s <= 12) || 1000;
          g.lineWidth = 1;
          g.font = `bold ${Math.max(10, Math.round(11 * kx))}px sans-serif`;
          g.textBaseline = "top";
          for (let x = 0; x <= nw; x += step) {
            g.strokeStyle = "rgba(216, 67, 91, 0.45)";
            g.beginPath(); g.moveTo(x * kx + 0.5, 0); g.lineTo(x * kx + 0.5, h); g.stroke();
            g.fillStyle = "rgba(42, 43, 48, 0.9)";
            g.fillText(String(x), x * kx + 2, 2);
          }
          for (let y = step; y <= nh; y += step) {
            g.strokeStyle = "rgba(216, 67, 91, 0.45)";
            g.beginPath(); g.moveTo(0, y * ky + 0.5); g.lineTo(w, y * ky + 0.5); g.stroke();
            g.fillStyle = "rgba(42, 43, 48, 0.9)";
            g.fillText(String(y), 2, y * ky + 2);
          }
        },
      });
    }
    const readonly = q.classList.contains("qtype_ddmarker-readonly");
    if (n) GR.scanApi.emit(ctx, `\nPlace each marker by giving "x,y" in the pixel coordinates of the grid on Image ${n} (0,0 is the top-left corner).`);
    // The inputs sit in div.ddform, next to the drop area rather than inside it.
    for (const input of q.querySelectorAll("input.choices[name]")) {
      const choiceNo = GR.classNum(input, "choice");
      const marker = el.querySelector(`.draghomes .marker.choice${choiceNo}:not(.dragplaceholder) .markertext`) || el.querySelector(`.marker.choice${choiceNo} .markertext`);
      const name = marker ? GR.clean(marker.innerText || marker.textContent) : `Marker ${choiceNo}`;
      const infinite = input.classList.contains("infinite");
      const max = infinite ? 0 : GR.classNum(input, "noofdrags") || 1;
      if (readonly) {
        GR.scanApi.emit(ctx, `\nMarker ${GR.scanApi.quote(name)}: ${input.value || "(not placed)"}`);
        continue;
      }
      const f = GR.scanApi.register(ctx, input, "moodle-ddmarker", { choiceNo, question: q, area: el, name, max, label: `Marker "${name}"` });
      const many = max === 1 ? "" : ` (up to ${max || "any number of"} copies: separate them with ";")`;
      GR.scanApi.emit(ctx, `\nMarker ${GR.scanApi.quote(name)}${many}: {{#${f.id} text ${GR.scanApi.quote(`x,y for ${name}`)}${input.value ? ` value=${GR.scanApi.quote(input.value)}` : ""}}} `);
    }
    GR.scanApi.emit(ctx, "\n");
    return true;
  }

  /* Ordering: one select per position. Filling reorders the list items and the hidden response. */
  function orderingSpecial(el, tag, ctx, q) {
    if (tag !== "ul" || !el.classList.contains("sortablelist")) return false;
    const lis = [...el.querySelectorAll("li.sortableitem")];
    const hidden = q.querySelector("input[type=hidden][name*='_response_']");
    if (!lis.length || !hidden) return false;
    const items = lis.map((li) => ({ id: li.id, el: li, text: GR.clean((li.querySelector("[data-itemcontent]") || li).innerText || li.textContent) }));
    const opts = items.map((it) => GR.scanApi.quote(it.text)).join(",");
    GR.scanApi.emit(ctx, `\nPut these ${items.length} items in order, first to last:\n`);
    items.forEach((it, i) => {
      const f = GR.scanApi.register(ctx, it.el, "moodle-order", { pos: i + 1, list: el, hidden, items, label: `Position ${i + 1}` });
      GR.scanApi.emit(ctx, `Position ${i + 1}: {{#${f.id} select "Position ${i + 1}" options=[${opts}] selected=${GR.scanApi.quote(it.text)}}}\n`);
    });
    return true;
  }

  /* Matching: label each select with its stem and leave out "Choose...". */
  function matchSpecial(el, tag, ctx, q) {
    if (tag !== "select") return false;
    const row = el.closest("tr");
    const stemTd = row && row.querySelector("td.text");
    const stem = stemTd ? GR.clean(stemTd.innerText || stemTd.textContent) : "";
    if (!stem || el.disabled) return false;
    const real = [...el.options].filter((o) => o.value !== "0" && o.value !== "");
    const sel = el.selectedOptions[0];
    const selected = sel && sel.value !== "0" && sel.value !== "" ? GR.clip(sel.text, 80) : "";
    const f = GR.scanApi.register(ctx, el, "select", { label: stem });
    GR.scanApi.emit(ctx, ` {{#${f.id} select ${GR.scanApi.quote(stem)} options=[${real.map((o) => GR.scanApi.quote(GR.clip(o.text, 80))).join(",")}]${selected ? ` selected=${GR.scanApi.quote(selected)}` : ""}}} `);
    return true;
  }

  /* CodeRunner: the answer textarea is the field, whatever editor sits on top of it. */
  function coderunnerSpecial(el, tag, ctx, q) {
    if (el.classList.contains("ui_wrapper") || el.classList.contains("sample-code-wrapper")) return true;
    if (tag !== "textarea" || !el.classList.contains("coderunner-answer")) return false;
    if (el.readOnly || el.disabled) return false;
    const langSel = q.querySelector("select.coderunner-lang-select");
    const lang = (langSel && langSel.value) || el.getAttribute("data-lang") || "";
    const label = `Answer code${lang ? ` (${lang})` : ""}`;
    const f = GR.scanApi.register(ctx, el, "moodle-coderunner", { label });
    const current = el.value.trim();
    GR.scanApi.emit(ctx, ` {{#${f.id} textarea ${GR.scanApi.quote(label)}${current ? ` value=${GR.scanApi.quote(current)}` : ""}}} `);
    return true;
  }

  /* Crossword: one field per clue, the clue text in its label; the answer is stored upper-case and padded with "_". */
  function crosswordSpecial(clue, tag, ctx, q) {
    if (!clue.classList.contains("wrap-clue")) return false;
    const el = clue.querySelector("input");
    if (!el || el.readOnly || el.disabled) return false;
    const content = clue.querySelector(".clue-content");
    const dir = clue.dataset.orientation === "1" ? "Down" : "Across";
    const label = `${clue.dataset.wordnumber || ""} ${dir}: ${GR.clean(content ? content.textContent : clue.dataset.clue || "")} (${clue.dataset.length || el.maxLength} letters)`;
    const f = GR.scanApi.register(ctx, el, "moodle-crossword", { label });
    const current = el.value.replace(/_/g, "").trim();
    GR.scanApi.emit(ctx, `\n{{#${f.id} text ${GR.scanApi.quote(label)}${current ? ` value=${GR.scanApi.quote(el.value)}` : ""}}}`);
    return true;
  }

  GR.specials.push(moodleSpecial);

  /* Moodle labels every field "… Question 3" for screen readers; the page text already says which question. */
  const baseLabelFilter = GR.labelFilter;
  GR.labelFilter = (el, label) => {
    const t = baseLabelFilter ? baseLabelFilter(el, label) : label;
    if (!t || !el.closest || !el.closest(".que")) return t;
    return t.replace(/\s*\bQuestion \d+\s*$/, "").replace(/^Question \d+\s+/, "").trim() || t;
  };

  /* Extra hints on plain inputs: gapfill's drag-and-drop words and STACK matrix cells. */
  const baseFieldHint = GR.fieldHint;
  GR.fieldHint = (el) => {
    let extra = baseFieldHint ? baseFieldHint(el) : "";
    const q = el.closest && el.closest(".que");
    if (!q) return extra;
    if (q.classList.contains("gapfill") && el.classList.contains("droptarget")) {
      const words = [...new Set([...q.querySelectorAll(".draggable.answers")].map((d) => GR.clean(d.textContent)).filter(Boolean))];
      if (words.length) extra += ` options=[${words.map((w) => GR.scanApi.quote(w)).join(",")}]`;
    }
    const cell = (el.name || "").match(/_sub_(\d+)_(\d+)$/);
    if (cell && el.closest("table.matrixtable")) extra += ` cell="row ${Number(cell[1]) + 1}, column ${Number(cell[2]) + 1}"`;
    return extra;
  };

  /* ---------- Fillers ---------- */

  /* ddwtos and ddimageortext: press Space on the drop zone until Moodle has put the wanted
     choice there. Moodle writes the hidden input and moves the word itself. */
  async function cycleTo(field, want) {
    const q = field.question;
    const input = field.el;
    const drop = () => q.querySelector(field.dropSelector);
    const cur = () => (input.value === "" ? "0" : input.value);
    want = String(want);
    if (cur() === want) return true;
    if (!(await GR.waitFor(() => drop(), 2000))) return false;
    // Moodle sets up drag and drop some time after the page loads (seconds on a slow computer); keys pressed before that are ignored.
    await GR.waitFor(() => q.querySelector(".draghome.unplaced, .draghome.placed"), 10000, 100);
    for (let step = 0; step < field.choices.length + 3; step++) {
      const before = cur();
      const key = want === "0" ? KEY_ESCAPE : KEY_SPACE;
      await GR.pressKey(drop(), ...key);
      if (!(await GR.waitFor(() => cur() !== before, 350, 20))) {
        // Still animating from an earlier move: wait for it and try once more.
        await settle(q);
        await GR.pressKey(drop(), ...key);
        if (!(await GR.waitFor(() => cur() !== before, 500, 20))) return false;
      }
      await settle(q);
      if (cur() === want) return true;
    }
    return cur() === want;
  }

  /* A choice that can only be used once may already sit in another zone; empty that zone first. */
  async function freeChoice(field, choice) {
    for (const other of field.question.querySelectorAll(`input.placeinput.group${field.group}[name]`)) {
      if (other === field.el || other.value !== String(choice)) continue;
      const place = GR.classNum(other, "place");
      const sel = field.dropSelector.replace(/place\d+$/, `place${place}`);
      await cycleTo(Object.assign({}, field, { el: other, dropSelector: sel }), "0");
    }
  }

  GR.fillers["moodle-dd"] = async (field, value) => {
    const choice = pickChoice(field.choices, value);
    if (!choice) return { ok: false, reason: `"${value}" is not one of the choices` };
    const prev = field.el.value || "0";
    let ok = await cycleTo(field, choice.choice);
    if (!ok) {
      await freeChoice(field, choice.choice);
      ok = await cycleTo(field, choice.choice);
    }
    let note = "";
    if (!ok) {
      // Moodle's script isn't running (or never answered): the hidden input is what gets submitted.
      setValue(field.el, String(choice.choice));
      note = "saved without moving the word on screen";
    }
    return {
      ok: true,
      note,
      undo: async () => {
        if (!(await cycleTo(field, prev))) setValue(field.el, prev === "0" ? "" : prev);
      },
    };
  };

  /* ddmarker: drag each marker with the mouse, the way a person would, so Moodle records it. */
  function parsePoints(value) {
    const s = Array.isArray(value) ? value.join(";") : String(value ?? "");
    return [...s.matchAll(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  }

  async function dragMarker(marker, img, pt) {
    const r = marker.getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    mouse(marker, "mousedown", sx, sy);
    await GR.sleep(20);
    // Moodle may move the marker when the drag starts; measure from where it is now.
    const start = marker.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const ratio = ir.width / (img.naturalWidth || ir.width);
    const tx = ir.left + 1 + pt.x * ratio, ty = ir.top + 1 + pt.y * ratio;
    const ex = sx + (tx - start.left), ey = sy + (ty - start.top);
    const doc = marker.ownerDocument;
    mouse(doc, "mousemove", (sx + ex) / 2, (sy + ey) / 2);
    mouse(doc, "mousemove", ex, ey);
    mouse(doc, "mouseup", ex, ey);
    await GR.sleep(40);
  }

  async function placeMarkers(field, points) {
    const area = field.area, input = field.el, n = field.choiceNo;
    const img = area.querySelector("img.dropbackground");
    if (!img) return false;
    img.scrollIntoView({ block: "center", inline: "nearest" });
    await GR.sleep(120);
    // Send home every copy already on the image, then drag fresh ones.
    for (const m of area.querySelectorAll(`.droparea .marker.choice${n}:not(.dragplaceholder)`)) {
      await GR.pressKey(m, ...KEY_SPACE);
      await GR.sleep(30);
    }
    for (const pt of points) {
      const marker = area.querySelector(`.draghomes .marker.choice${n}:not(.dragplaceholder):not(.beingdragged)`);
      if (!marker) break;
      await dragMarker(marker, img, pt);
    }
    const got = parsePoints(input.value);
    return got.length === points.length && got.every((p, i) => Math.abs(p.x - points[i].x) <= 2 && Math.abs(p.y - points[i].y) <= 2);
  }

  GR.fillers["moodle-ddmarker"] = async (field, value) => {
    let points = parsePoints(value);
    if (!points.length) return { ok: false, reason: `expected "x,y", got "${value}"` };
    if (field.max) points = points.slice(0, field.max);
    const prev = field.el.value;
    const want = points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(";");
    let note = "";
    if (!(await placeMarkers(field, points))) {
      setValue(field.el, want);
      note = "saved without moving the marker on screen";
    }
    return {
      ok: true,
      note,
      undo: async () => {
        const back = parsePoints(prev);
        if (!(await placeMarkers(field, back))) setValue(field.el, prev);
      },
    };
  };

  GR.fillers["moodle-order"] = async (field, value) => {
    const { list, hidden, items } = field;
    const order = (GR.orderPlans = GR.orderPlans || new WeakMap());
    const plan = order.get(list) || new Map();
    order.set(list, plan);
    plan.set(field.pos, String(Array.isArray(value) ? value[0] : value ?? ""));

    const prevIds = [...list.querySelectorAll("li.sortableitem")].map((li) => li.id);
    const prevValue = hidden.value;
    const used = new Set();
    const placed = [];
    for (let p = 1; p <= items.length; p++) {
      const wanted = plan.get(p);
      const free = items.filter((it) => !used.has(it.id));
      const hit = wanted ? pickChoice(free.map((it) => ({ text: it.text, it })), wanted) : null;
      // Positions the model hasn't named yet keep the remaining items in their current order.
      const it = hit ? hit.it : null;
      placed[p - 1] = it;
      if (it) used.add(it.id);
    }
    const rest = prevIds.map((id) => items.find((it) => it.id === id)).filter((it) => it && !used.has(it.id));
    const final = placed.map((it) => it || rest.shift());
    for (const it of final) list.appendChild(it.el);
    hidden.value = final.map((it) => it.id).join(",");
    fireValue(hidden);
    return {
      ok: true,
      undo: async () => {
        for (const id of prevIds) {
          const it = items.find((x) => x.id === id);
          if (it) list.appendChild(it.el);
        }
        hidden.value = prevValue;
        fireValue(hidden);
        plan.clear();
      },
    };
  };

  /* Calls on the page's own objects: directly in Firefox, through the page bridge in Chrome. */
  async function pageOp(op, el, ...args) {
    if (!GR.firefox) {
      const res = await GR.pageCall(op, el, args);
      return res.ok ? res.value : null;
    }
    try {
      const page = GR.pageObj(el);
      if (op === "aceGet" || op === "aceSet") {
        const ed = page.env && page.env.editor;
        if (!ed) return null;
        if (op === "aceGet") return ed.getValue();
        ed.session.setValue(args[0]);
        return true;
      }
      if (op === "uiReload") {
        // CodeRunner: stop the editor on top of the answer box (it saves itself), set the box, rebuild.
        const ui = page.current_ui_wrapper;
        if (!ui || typeof ui.stop !== "function" || typeof ui.restart !== "function") return false;
        ui.stop();
        el.value = args[0];
        ui.restart();
        return true;
      }
      if (op === "tinySet" || op === "tinySave") {
        const win = GR.pageObj(GR.view(el));
        const tiny = win.tinyMCE || win.tinymce;
        const ed = tiny && tiny.get(el.id);
        if (!ed) return false;
        if (op === "tinySet") {
          ed.setContent(args[0]);
          ed.save();
          // TinyMCE 6+ calls it dispatch; older versions fire.
          if (typeof ed.dispatch === "function") ed.dispatch("change");
          else if (typeof ed.fire === "function") ed.fire("change");
        } else {
          ed.save();
        }
        return true;
      }
    } catch (e) { /* page object unavailable */ }
    return null;
  }

  async function setCode(ta, code) {
    const wrapper = ta.ownerDocument.getElementById(ta.id + "_wrapper");
    const aceEl = wrapper && wrapper.querySelector(".ace_editor");
    if (aceEl && aceEl.closest(".ui_wrapper") === wrapper && (await pageOp("aceSet", aceEl, code))) {
      if (ta.value !== code) setValue(ta, code);
      return;
    }
    // Any other CodeRunner UI is rebuilt from the box; with no UI the box is the answer.
    if (!(await pageOp("uiReload", ta, code))) setValue(ta, code);
    else fireValue(ta);
  }

  GR.fillers["moodle-coderunner"] = async (field, value) => {
    const code = Array.isArray(value) ? value.join("\n") : String(value ?? "");
    const prev = field.el.value;
    await setCode(field.el, code);
    return { ok: true, undo: async () => setCode(field.el, prev) };
  };

  GR.fillers.ace = async (field, value) => {
    const prev = await pageOp("aceGet", field.el);
    if (prev === null) return { ok: false, reason: "the code editor isn't reachable" };
    await pageOp("aceSet", field.el, Array.isArray(value) ? value.join("\n") : String(value ?? ""));
    return { ok: true, undo: async () => pageOp("aceSet", field.el, prev) };
  };

  GR.fillers["moodle-crossword"] = async (field, value) => {
    const el = field.el;
    const len = Number(el.getAttribute("maxlength")) || el.value.length;
    const fixed = new Map();
    [...el.value].forEach((ch, i) => { if (ch === " " || ch === "-") fixed.set(i, ch); });
    const letters = [...String(value ?? "").toUpperCase()].filter((ch) => ch !== " " && ch !== "-" && ch !== "_");
    const out = [];
    for (let i = 0; i < len; i++) out.push(fixed.has(i) ? fixed.get(i) : letters.shift() || "_");
    const prev = el.value;
    const apply = (v) => {
      el.value = v;
      // The clue box redraws the grid from its value on "cut" (with nothing selected, nothing is cut).
      try {
        // Focusing the box makes it the crossword's current word, which is the one the grid redraws.
        el.focus({ preventScroll: true });
        GR.view(el).getSelection().removeAllRanges();
        el.setSelectionRange(0, 0);
        el.dispatchEvent(new ClipboardEvent("cut", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
      } catch (e) { /* grid stays as it was; the answer is still in the box */ }
      el.value = v;
      fireValue(el);
    };
    apply(out.join(""));
    return { ok: true, undo: async () => apply(prev) };
  };

  /* STACK validates each answer on the server about a second after it changes, and only a
     validated answer counts in some quiz modes. Wait until none is still pending. */
  const STACK_PENDING = ".que.stack .stackinputfeedback.waiting, .que.stack .stackinputfeedback.loading";
  const baseAfterFills = GR.afterFills;
  GR.afterFills = async () => {
    if (baseAfterFills) await baseAfterFills();
    if (!document.querySelector(".que.stack")) return;
    if (!document.querySelector(STACK_PENDING)) await GR.sleep(200);
    await GR.waitFor(() => !document.querySelector(STACK_PENDING), 10000, 100);
  };

  /* ---------- Rich-text editors ---------- */

  /* The textarea behind a TinyMCE editing area (body#tinymce in its iframe). */
  function tinyTextarea(el) {
    const body = el.ownerDocument && el.ownerDocument.body;
    const id = body && body.id === "tinymce" && body.dataset.id;
    const frame = id && GR.view(el).frameElement;
    return frame ? frame.ownerDocument.getElementById(id) : null;
  }

  const baseAfterEditable = GR.afterEditable;
  GR.afterEditable = (el, text) => {
    if (baseAfterEditable) baseAfterEditable(el, text);
    const html = textToHtml(text);

    const ta = tinyTextarea(el);
    if (ta) {
      // TinyMCE saves its editing area into the textarea on submit; set both now so they agree.
      pageOp("tinySet", ta, html).then((ok) => { if (!ok) setValue(ta, html); });
      return;
    }

    // Atto copies its content into the textarea on keyup and blur; set both so they agree now.
    const atto = el.closest(".editor_atto_wrap");
    if (atto) {
      el.replaceChildren(...textToNodes(el.ownerDocument, text));
      const area = el.id ? el.ownerDocument.getElementById(el.id.replace(/editable$/, "")) : null;
      if (area && area.localName === "textarea") setValue(area, html);
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
    }
  };

  /* Undo restores the editing area itself; push that back into the textareas Moodle submits. */
  const baseUndoAll = GR.undoAll;
  GR.undoAll = async () => {
    const n = await baseUndoAll();
    for (const ed of document.querySelectorAll(".editor_atto_content")) ed.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
    for (const fr of document.querySelectorAll(".tox-edit-area iframe")) {
      try {
        const ta = tinyTextarea(fr.contentDocument.body);
        if (ta) await pageOp("tinySave", ta);
      } catch (e) { /* cross-origin or gone */ }
    }
    return n;
  };
})();
