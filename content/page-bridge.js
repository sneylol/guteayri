/* GuteAyri — page bridge (Chrome and Safari; runs in the page's own JavaScript world).
   Firefox content scripts reach page objects through wrappedJSObject. Chrome keeps content
   scripts apart from the page, so the few calls that need the page's own objects come here:
   the content script marks the element with data-guteayri-target, sends "guteayri:page",
   and gets "guteayri:page-result" back. Every operation only touches the marked element. */
(() => {
  if (window.__guteayriPageBridge) return;
  window.__guteayriPageBridge = true;
  // Lets the content script see that the bridge is running in this document.
  document.documentElement.setAttribute("data-guteayri-bridge", "");

  const tiny = () => window.tinyMCE || window.tinymce;

  const ops = {
    /* Key events whose keyCode the page can read (Chrome ignores keyCode in the constructor). */
    key(el, key, code, keyCode) {
      for (const type of ["keydown", "keyup"]) {
        const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(ev, "keyCode", { get: () => keyCode });
        Object.defineProperty(ev, "which", { get: () => keyCode });
        el.dispatchEvent(ev);
      }
      return true;
    },
    aceGet(el) {
      const ed = el.env && el.env.editor;
      return ed ? ed.getValue() : null;
    },
    aceSet(el, value) {
      const ed = el.env && el.env.editor;
      if (!ed) return false;
      ed.session.setValue(value);
      return true;
    },
    /* CodeRunner: stop the editor on top of the answer box (it saves itself), set the box, rebuild. */
    uiReload(el, value) {
      const ui = el.current_ui_wrapper;
      if (!ui || typeof ui.stop !== "function" || typeof ui.restart !== "function") return false;
      ui.stop();
      el.value = value;
      ui.restart();
      return true;
    },
    tinySet(el, html) {
      const ed = tiny() && tiny().get(el.id);
      if (!ed) return false;
      ed.setContent(html);
      ed.save();
      if (typeof ed.dispatch === "function") ed.dispatch("change");
      else if (typeof ed.fire === "function") ed.fire("change");
      return true;
    },
    tinySave(el) {
      const ed = tiny() && tiny().get(el.id);
      if (!ed) return false;
      ed.save();
      return true;
    },
  };

  document.addEventListener("guteayri:page", (e) => {
    let req;
    try {
      req = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    if (!req || typeof req.id !== "string" || !Object.prototype.hasOwnProperty.call(ops, req.op)) return;
    const el = document.querySelector(`[data-guteayri-target="${CSS.escape(req.id)}"]`);
    let res;
    try {
      res = el ? { id: req.id, ok: true, value: ops[req.op](el, ...(req.args || [])) } : { id: req.id, ok: false, error: "element not found" };
    } catch (err) {
      res = { id: req.id, ok: false, error: String((err && err.message) || err) };
    }
    document.dispatchEvent(new CustomEvent("guteayri:page-result", { detail: JSON.stringify(res) }));
  });
})();
