/* GuteAyri — content-script namespace and shared helpers. */
(() => {
  if (globalThis.GR && globalThis.GR.loaded) return;

  const GR = (globalThis.GR = {
    loaded: true,
    isTop: window === window.top,
    hostEl: null,
    busy: false,
  });

  /* Site and widget adapters plug in here (content/moodle.js).
     specials: (el, tag, ctx) => true when the adapter emitted the element itself.
     fillers:  kind -> async (field, value) => { ok, reason, note, undo } */
  GR.specials = [];
  GR.fillers = {};

  GR.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  GR.waitFor = async (test, timeout = 1000, step = 40) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (test()) return true;
      await GR.sleep(step);
    }
    return !!test();
  };

  /* The page's own JavaScript objects (editor instances and the like). In Firefox
     content scripts see DOM objects through Xray wrappers; wrappedJSObject reaches past them. */
  GR.firefox = typeof cloneInto === "function";
  GR.pageObj = (o) => (o && o.wrappedJSObject) || o;
  GR.toPage = (value, el) => (GR.firefox ? cloneInto(value, GR.view(el)) : value);

  /* Chrome keeps content scripts out of the page's JavaScript, so calls on page objects go through
     content/page-bridge.js, which runs in the page. Resolves to { ok, value } or { ok: false }. */
  let bridgeSeq = 0;
  /* The bridge normally arrives as a page-world content script. Where a browser doesn't run those
     (some Safari versions), load the same file into the page as an extension script. */
  async function ensureBridge(doc) {
    if (doc.documentElement.hasAttribute("data-guteayri-bridge")) return;
    const s = doc.createElement("script");
    s.src = browser.runtime.getURL("content/page-bridge.js");
    const loaded = new Promise((r) => { s.onload = s.onerror = r; });
    (doc.head || doc.documentElement).appendChild(s);
    await Promise.race([loaded, GR.sleep(1000)]);
    s.remove();
  }

  GR.pageCall = async (op, el, args = []) => {
    await ensureBridge(el.ownerDocument || document);
    return pageCallNow(op, el, args);
  };

  const pageCallNow = (op, el, args) =>
    new Promise((resolve) => {
      const doc = el.ownerDocument || document;
      const id = `guteayri-${Date.now().toString(36)}-${bridgeSeq++}`;
      let timer = null;
      const onResult = (e) => {
        let res;
        try { res = JSON.parse(e.detail); } catch (err) { return; }
        if (res && res.id === id) done(res);
      };
      const done = (res) => {
        clearTimeout(timer);
        doc.removeEventListener("guteayri:page-result", onResult);
        el.removeAttribute("data-guteayri-target");
        resolve(res);
      };
      el.setAttribute("data-guteayri-target", id);
      doc.addEventListener("guteayri:page-result", onResult);
      timer = setTimeout(() => done({ ok: false, error: "the page bridge didn't answer" }), 1500);
      doc.dispatchEvent(new CustomEvent("guteayri:page", { detail: JSON.stringify({ id, op, args }) }));
    });

  /* Keyboard input the page's handlers can read, including legacy keyCode. Firefox takes keyCode
     in the event constructor; Chrome ignores it there, so the page bridge sends the keys instead. */
  const keyCodeWorks = new KeyboardEvent("keydown", { keyCode: 32 }).keyCode === 32;
  GR.pressKey = async (el, key, code, keyCode) => {
    if (!keyCodeWorks) {
      const res = await GR.pageCall("key", el, [key, code, keyCode]);
      if (res.ok) return;
    }
    for (const type of ["keydown", "keyup"]) {
      const ev = new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true });
      if (ev.keyCode !== keyCode) {
        try {
          Object.defineProperty(ev, "keyCode", { get: () => keyCode });
          Object.defineProperty(ev, "which", { get: () => keyCode });
        } catch (e) { /* read-only in this engine */ }
      }
      el.dispatchEvent(ev);
    }
  };

  /* Number at the end of a class such as "place3" or "group1". */
  GR.classNum = (el, prefix) => {
    for (const c of el.classList) {
      const m = c.match(new RegExp("^" + prefix + "(\\d+)$"));
      if (m) return Number(m[1]);
    }
    return null;
  };

  GR.clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  GR.clip = (s, n = 100) => {
    const t = GR.clean(s);
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  };

  GR.norm = (s) =>
    GR.clean(s)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();

  GR.letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

  GR.view = (el) => (el && el.ownerDocument && el.ownerDocument.defaultView) || window;

  /* True when the element renders a box. display:contents has no box but its
     children do, so it counts as visible. */
  GR.visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.checkVisibility) {
      if (el.checkVisibility({ checkVisibilityCSS: true })) return true;
      try {
        return GR.view(el).getComputedStyle(el).display === "contents";
      } catch (e) {
        return false;
      }
    }
    return el.getClientRects().length > 0;
  };

  /* A frame whose parent can reach into it is scanned by the parent. */
  GR.handledByParent = () => {
    if (GR.isTop) return false;
    try {
      return !!window.frameElement && !!window.parent.document;
    } catch (e) {
      return false;
    }
  };

  GR.settings = () => guteayriLoadSettings();

  GR.send = (msg) => browser.runtime.sendMessage(msg);

  /* Fonts for the in-page panel, loaded from the extension so page CSP can't block them. */
  let fontsPromise = null;
  GR.loadFonts = () => {
    if (fontsPromise) return fontsPromise;
    const faces = [
      ["GuteAyri Barlow", 400, "Barlow-400.woff2"],
      ["GuteAyri Barlow", 500, "Barlow-500.woff2"],
      ["GuteAyri Barlow", 600, "Barlow-600.woff2"],
      ["GuteAyri Barlow Condensed", 500, "BarlowCondensed-500.woff2"],
      ["GuteAyri Barlow Condensed", 600, "BarlowCondensed-600.woff2"],
      ["GuteAyri Barlow Condensed", 700, "BarlowCondensed-700.woff2"],
    ];
    fontsPromise = Promise.all(
      faces.map(async ([family, weight, file]) => {
        try {
          const res = await fetch(browser.runtime.getURL("fonts/" + file));
          const buf = await res.arrayBuffer();
          const face = new FontFace(family, buf, { weight: String(weight), style: "normal" });
          await face.load();
          document.fonts.add(face);
        } catch (e) {
          /* the panel falls back to system fonts */
        }
      })
    );
    return fontsPromise;
  };

  /* Page-level styles for marking filled fields. Injected per document, including same-origin frames,
     and per shadow root, since a document's styles don't reach inside one. */
  GR.ensurePageStyle = (doc) => {
    if (!doc || doc.getElementById("guteayri-page-style")) return;
    const style = (doc.ownerDocument || doc).createElement("style");
    style.id = "guteayri-page-style";
    style.textContent = `
      [data-guteayri-mark] { outline: 2px solid #D8435B !important; outline-offset: 2px !important; transition: outline-color .3s ease; }
      [data-guteayri-mark="unsure"] { outline-style: dashed !important; }
      [data-guteayri-mark="failed"] { outline-color: #9a9ca3 !important; outline-style: dotted !important; }
      [data-guteayri-flash] { animation: guteayri-flash 1.1s ease 2; }
      @keyframes guteayri-flash { 0%,100% { outline-color: #D8435B; outline-width: 2px; } 50% { outline-color: #2A2B30; outline-width: 4px; } }
      @media (prefers-reduced-motion: reduce) { [data-guteayri-flash] { animation: none; outline-width: 4px !important; } }
    `;
    (doc.head || doc.documentElement || doc).appendChild(style);
  };
})();
