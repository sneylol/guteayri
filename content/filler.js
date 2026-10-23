/* GuteAyri — enters answers into fields so that frameworks (React, Vue, Angular,
   Google Forms, Moodle, Canvas, Microsoft Forms, rich-text editors) register them.
   Every change is snapshotted first so it can be undone. */
(() => {
  const GR = globalThis.GR;
  if (GR.applyFill) return;

  const undoStack = (GR.undoStack = []);
  GR.attempted = new WeakSet();

  function fire(el, type, init) {
    const Ctor = type === "input" || type === "beforeinput" ? InputEvent : type.startsWith("key") ? KeyboardEvent : Event;
    el.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: type !== "change", composed: true }, init || {})));
  }

  function mouse(el, type, x, y, buttons) {
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons };
    if (type.startsWith("pointer")) {
      el.dispatchEvent(new PointerEvent(type, Object.assign(init, { pointerId: 1, pointerType: "mouse", isPrimary: true })));
    } else {
      el.dispatchEvent(new MouseEvent(type, init));
    }
  }

  /* A full pointer sequence: some widgets only react to mousedown or pointerup. */
  GR.realClick = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    mouse(el, "pointerover", x, y, 0);
    mouse(el, "mouseover", x, y, 0);
    mouse(el, "pointerdown", x, y, 1);
    mouse(el, "mousedown", x, y, 1);
    if (el.focus) el.focus({ preventScroll: true });
    mouse(el, "pointerup", x, y, 0);
    mouse(el, "mouseup", x, y, 0);
    mouse(el, "click", x, y, 0);
  };

  /* Sets .value through the prototype setter so React's value tracker sees a change. */
  function setNativeValue(el, value) {
    const proto =
      el.localName === "textarea" ? HTMLTextAreaElement.prototype : el.localName === "select" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function typeInto(el, text) {
    if (el.focus) el.focus({ preventScroll: true });
    fire(el, "focus", { bubbles: false });
    fire(el, "focusin");
    fire(el, "keydown", { key: "Unidentified" });
    fire(el, "beforeinput", { inputType: "insertText", data: text });
    setNativeValue(el, text);
    fire(el, "input", { inputType: "insertText", data: text });
    fire(el, "keyup", { key: "Unidentified" });
    fire(el, "change");
    fire(el, "blur", { bubbles: false });
    fire(el, "focusout");
  }

  function toBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return /^(true|yes|1|checked|on|x|selected|correct|ja)$/i.test(String(v).trim());
  }

  GR.toBool = toBool;

  function coerce(el, type, value) {
    let v = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    if (type === "number" || type === "range") {
      const m = v.replace(/(\d),(\d)/g, "$1.$2").match(/-?\d+(\.\d+)?(e-?\d+)?/i);
      v = m ? m[0] : "";
      if (type === "range" && v !== "") {
        const min = el.min !== "" ? Number(el.min) : 0, max = el.max !== "" ? Number(el.max) : 100;
        v = String(Math.min(max, Math.max(min, Number(v))));
      }
    } else if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d)) v = d.toISOString().slice(0, 10);
    } else if (type === "time") {
      const m = v.match(/(\d{1,2}):(\d{2})/);
      if (m) v = `${m[1].padStart(2, "0")}:${m[2]}`;
    } else if (type === "color" && !/^#[0-9a-f]{6}$/i.test(v)) {
      const m = v.match(/#?([0-9a-f]{6})/i);
      if (m) v = "#" + m[1];
    }
    return v;
  }

  function isOn(el) {
    return (
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-selected") === "true" ||
      el.getAttribute("aria-pressed") === "true" ||
      el.classList.contains("selected") ||
      el.classList.contains("active")
    );
  }

  function bestMatch(candidates, wanted, textOf) {
    const w = GR.norm(wanted);
    if (!w) return null;
    let best = null, bestScore = 0;
    for (const c of candidates) {
      const t = GR.norm(textOf(c));
      if (!t) continue;
      let score = 0;
      if (t === w) score = 100;
      else if (t.startsWith(w) || w.startsWith(t)) score = 70 - Math.abs(t.length - w.length) / 10;
      else if (t.includes(w) || w.includes(t)) score = 50 - Math.abs(t.length - w.length) / 10;
      else {
        const tw = new Set(t.split(" ")), ww = w.split(" ");
        const hit = ww.filter((x) => tw.has(x)).length;
        score = hit ? (30 * hit) / Math.max(ww.length, tw.size) : 0;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore >= 15 ? best : null;
  }

  function snapshot(field) {
    const el = field.el;
    const s = { field };
    if (el.localName === "input" && (el.type === "radio" || el.type === "checkbox")) s.checked = el.checked;
    else if (el.localName === "select") s.selected = [...el.options].map((o) => o.selected);
    else if (el.localName === "input" || el.localName === "textarea") s.value = el.value;
    else if (el.isContentEditable) s.nodes = [...el.childNodes].map((n) => n.cloneNode(true));
    else s.on = isOn(el);
    if ((field.kind === "aria-radio" || field.kind === "option") && field.group) {
      const prev = GR.groupMembers(field.group).find((m) => m.el !== el && isOn(m.el));
      if (prev) s.prevOn = prev.el;
    }
    // For radio groups, remember which sibling was checked so undo restores it.
    if (el.type === "radio" && el.name) {
      const root = el.form || el.ownerDocument;
      s.prevRadio = [...root.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].find((r) => r.checked) || null;
    }
    return s;
  }

  async function fillCombo(el, text) {
    const doc = el.ownerDocument;
    if (el.localName === "input") {
      typeInto(el, text);
      if (el.focus) el.focus({ preventScroll: true });
      fire(el, "input", { inputType: "insertText", data: text });
    } else {
      GR.realClick(el);
    }
    let option = null;
    for (let i = 0; i < 8 && !option; i++) {
      await GR.sleep(120);
      const ctl = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      const scope = (ctl && doc.getElementById(ctl)) || doc;
      const opts = [...scope.querySelectorAll('[role=option], [role=menuitem], li[data-value], .select2-results__option, .vs__dropdown-option, .ant-select-item-option')].filter(GR.visible);
      option = bestMatch(opts, text, (o) => o.innerText || o.textContent);
    }
    if (option) {
      GR.realClick(option);
      return { ok: true };
    }
    fire(el, "keydown", { key: "Escape" });
    return el.localName === "input" ? { ok: true } : { ok: false, reason: "option not found" };
  }

  function fillEditable(el, text) {
    const doc = el.ownerDocument;
    const win = GR.view(el);
    el.focus({ preventScroll: true });
    const sel = win.getSelection();
    sel.removeAllRanges();
    const range = doc.createRange();
    range.selectNodeContents(el);
    sel.addRange(range);
    let ok = false;
    try {
      ok = doc.execCommand("insertText", false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok || GR.norm(el.innerText).indexOf(GR.norm(text).slice(0, 40)) === -1) {
      el.textContent = "";
      text.split("\n").forEach((line, i, arr) => {
        el.appendChild(doc.createTextNode(line));
        if (i < arr.length - 1) el.appendChild(doc.createElement("br"));
      });
      fire(el, "input", { inputType: "insertText", data: text });
    }
    fire(el, "change");
    fire(el, "blur", { bubbles: false });
    if (GR.afterEditable) GR.afterEditable(el, text);
    return { ok: true };
  }

  function fillSelect(el, value) {
    const wanted = Array.isArray(value) ? value : [value];
    const opts = [...el.options];
    const picks = [];
    for (const w of wanted) {
      const ws = String(w);
      let o = opts.find((x) => GR.clean(x.text) === GR.clean(ws)) || opts.find((x) => x.value === ws);
      if (!o) {
        const idx = ws.match(/^#?(\d+)$/);
        if (idx && opts[Number(idx[1])]) o = opts[Number(idx[1])];
      }
      if (!o) o = bestMatch(opts.filter((x) => !x.disabled && x.value !== ""), ws, (x) => x.text);
      if (o) picks.push(o);
    }
    if (!picks.length) return { ok: false, reason: "option not found" };
    el.focus({ preventScroll: true });
    if (el.multiple) opts.forEach((o) => (o.selected = picks.includes(o)));
    else setNativeValue(el, picks[0].value);
    if (!el.multiple && el.selectedIndex !== picks[0].index) el.selectedIndex = picks[0].index;
    fire(el, "input");
    fire(el, "change");
    fire(el, "blur", { bubbles: false });
    return { ok: true };
  }

  function markTarget(el) {
    if (el.localName === "input" && (el.type === "radio" || el.type === "checkbox")) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || !GR.visible(el)) {
        return (el.labels && el.labels[0]) || el.closest("label") || el.parentElement || el;
      }
    }
    return el;
  }

  GR.mark = (field, state) => {
    const t = markTarget(field.el);
    GR.ensurePageStyle(t.ownerDocument);
    t.setAttribute("data-guteayri-mark", state);
    field.markEl = t;
  };

  GR.clearMarks = () => {
    for (const f of GR.registry.byId.values()) {
      if (f.markEl) f.markEl.removeAttribute("data-guteayri-mark");
    }
  };

  GR.flash = (ids) => {
    let first = null;
    for (const id of ids) {
      const f = GR.fieldById(id);
      if (!f) continue;
      const t = f.markEl || markTarget(f.el);
      if (!first) first = t;
      t.removeAttribute("data-guteayri-flash");
      void t.offsetWidth;
      t.setAttribute("data-guteayri-flash", "");
      setTimeout(() => t.removeAttribute("data-guteayri-flash"), 2400);
    }
    if (first) first.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  /* Applies one fill. Returns { ok, reason }. */
  GR.applyFill = async (fill, record = true) => {
    const field = GR.fieldById(fill.id);
    if (!field) return { ok: false, reason: "field is gone" };
    const el = field.el;
    const value = fill.value;
    const snap = snapshot(field);
    let result = { ok: true };

    try {
      if (GR.fillers[field.kind]) {
        result = await GR.fillers[field.kind](field, value);
        GR.attempted.add(el);
        if (record && result.ok && !result.skipped && result.undo) undoStack.push({ field, custom: result.undo });
        return result;
      }
      switch (field.kind) {
        case "radio": {
          if (!toBool(value)) { result = { ok: true, skipped: true }; break; }
          if (!el.checked) el.click();
          if (!el.checked) { el.checked = true; fire(el, "input"); fire(el, "change"); }
          break;
        }
        case "checkbox": {
          const want = toBool(value);
          if (el.checked !== want) el.click();
          if (el.checked !== want) { el.checked = want; fire(el, "input"); fire(el, "change"); }
          break;
        }
        case "aria-radio":
        case "option":
        case "button": {
          if (!toBool(value)) { result = { ok: true, skipped: true }; break; }
          if (!isOn(el)) GR.realClick(el);
          break;
        }
        case "aria-checkbox": {
          const want = toBool(value);
          if (isOn(el) !== want) GR.realClick(el);
          break;
        }
        case "select":
          result = fillSelect(el, value);
          break;
        case "combo":
          result = await fillCombo(el, Array.isArray(value) ? value[0] : String(value));
          break;
        case "editable":
          result = fillEditable(el, Array.isArray(value) ? value.join("\n") : String(value ?? ""));
          break;
        default: {
          const type = field.inputType || "text";
          const v = coerce(el, type, value);
          typeInto(el, v);
          if (el.value !== v && type !== "textarea") {
            setNativeValue(el, v);
            fire(el, "input");
            fire(el, "change");
          }
        }
      }
    } catch (e) {
      result = { ok: false, reason: e.message || "couldn't enter the answer" };
    }

    GR.attempted.add(el);
    if (record && result.ok && !result.skipped) undoStack.push(snap);
    return result;
  };

  GR.undoAll = async () => {
    let n = 0;
    while (undoStack.length) {
      const s = undoStack.pop();
      const el = s.field.el;
      if (!el.isConnected) continue;
      try {
        if (s.custom) {
          await s.custom();
        } else if ("checked" in s) {
          if (el.type === "radio") {
            if (s.prevRadio && s.prevRadio !== el) {
              const prev = s.prevRadio;
              // A disabled "nothing chosen" radio (Moodle's "Clear my choice") is reset through its label's link.
              const label = prev.disabled && prev.labels && prev.labels[0];
              if (label) (label.querySelector("a, button, [role=button]") || label).click();
              else prev.click();
              if (!prev.checked) { prev.checked = true; fire(prev, "input"); fire(prev, "change"); }
            } else if (!s.prevRadio) { el.checked = false; fire(el, "input"); fire(el, "change"); }
          } else if (el.checked !== s.checked) el.click();
        } else if (s.selected) {
          [...el.options].forEach((o, i) => (o.selected = s.selected[i]));
          fire(el, "input");
          fire(el, "change");
        } else if ("value" in s) {
          typeInto(el, s.value);
        } else if (s.nodes) {
          el.replaceChildren(...s.nodes);
          fire(el, "input");
        } else if ("on" in s && s.field.kind === "aria-checkbox" && isOn(el) !== s.on) {
          GR.realClick(el);
        } else if (s.prevOn && s.prevOn.isConnected) {
          GR.realClick(s.prevOn);
        }
        n++;
      } catch (e) {
        /* keep undoing the rest */
      }
      if (s.field.markEl) s.field.markEl.removeAttribute("data-guteayri-mark");
      GR.attempted.delete(el);
    }
    return n;
  };
})();
