/* GuteAyri — turns the images found by the scanner into base64 JPEGs.
   Order of attempts: draw the element locally → fetch the URL through the background
   page (carries the site's cookies) → crop it out of a screenshot. */
(() => {
  const GR = globalThis.GR;
  if (GR.collectImages) return;

  const MAX_SIDE = 1400;

  function canvasToPart(canvas) {
    const url = canvas.toDataURL("image/jpeg", 0.9); // throws on tainted canvases
    return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  }

  function drawScaled(source, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return canvasToPart(c);
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = src;
    });
  }

  async function fromSvg(svg) {
    const r = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("width")) clone.setAttribute("width", Math.round(r.width));
    if (!clone.getAttribute("height")) clone.setAttribute("height", Math.round(r.height));
    const xml = new XMLSerializer().serializeToString(clone);
    const img = await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml));
    const scale = Math.min(3, Math.max(1, 900 / Math.max(r.width, r.height)));
    return drawScaled(img, r.width * scale, r.height * scale);
  }

  function imgUrl(img) {
    return img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original") || "";
  }

  async function viaBackground(url) {
    if (!url || /^(about|javascript):/i.test(url)) return null;
    if (url.startsWith("data:")) {
      const res = await GR.send({ type: "normalizeImage", dataUrl: url, max: MAX_SIDE });
      return res && res.ok ? res.img : null;
    }
    const res = await GR.send({ type: "fetchImage", url: new URL(url, location.href).href });
    return res && res.ok ? res.img : null;
  }

  /* Hides the panel while the browser takes a screenshot so it never covers the page. */
  GR.withPanelHidden = async (fn) => {
    const host = GR.hostEl;
    const prev = host ? host.style.visibility : "";
    if (host) host.style.visibility = "hidden";
    try {
      await GR.sleep(60);
      return await fn();
    } finally {
      if (host) host.style.visibility = prev;
    }
  };

  GR.captureViewport = async (max = 1600) => {
    const res = await GR.withPanelHidden(() => GR.send({ type: "capture", max }));
    return res && res.ok ? res.img : null;
  };

  async function viaScreenshot(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await GR.sleep(250);
    const res = await GR.withPanelHidden(() => GR.send({ type: "capture" }));
    if (!res || !res.ok) return null;
    const shot = await loadImg(res.img.dataUrl);
    const r = el.getBoundingClientRect();
    // Account for the element sitting inside same-origin frames.
    let ox = 0, oy = 0, win = GR.view(el);
    while (win && win !== window.top && win.frameElement) {
      const fr = win.frameElement.getBoundingClientRect();
      ox += fr.left;
      oy += fr.top;
      win = win.parent;
    }
    const k = shot.naturalWidth / window.innerWidth;
    const sx = Math.max(0, (r.left + ox) * k), sy = Math.max(0, (r.top + oy) * k);
    const sw = Math.min(shot.naturalWidth - sx, r.width * k), sh = Math.min(shot.naturalHeight - sy, r.height * k);
    if (sw < 4 || sh < 4) return null;
    const c = document.createElement("canvas");
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    c.getContext("2d").drawImage(shot, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return drawScaled(c, c.width, c.height);
  }

  /* Routes that don't need scrolling: draw locally, or fetch through the background page. */
  async function quickRoute(item) {
    const el = item.el;
    const tag = el.localName;
    try {
      if (tag === "img" && el.complete && el.naturalWidth > 0) return drawScaled(el, el.naturalWidth, el.naturalHeight);
      if (tag === "canvas") return drawScaled(el, el.width, el.height);
      if (tag === "svg") return await fromSvg(el);
    } catch (e) {
      /* tainted or undecodable — try the next route */
    }
    if (tag === "img") {
      try { return await viaBackground(imgUrl(el)); } catch (e) { return null; }
    }
    return null;
  }

  /* Draws an adapter's annotations (numbered drop zones, a coordinate grid) onto a collected image. */
  async function annotate(part, overlay) {
    const img = await loadImg(`data:${part.mime};base64,${part.data}`);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    overlay(g, c.width, c.height);
    return canvasToPart(c);
  }

  /* Shared drawing helpers for overlays. */
  GR.drawTag = (g, x, y, text, size) => {
    const r = Math.max(9, size || 11);
    g.font = `bold ${Math.round(r * 1.15)}px sans-serif`;
    const w = Math.max(r * 2, g.measureText(text).width + r);
    g.fillStyle = "#D8435B";
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(x - w / 2, y - r, w, r * 2, r);
    else g.rect(x - w / 2, y - r, w, r * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, x, y + 1);
  };

  GR.collectImages = async (items, onProgress) => {
    const out = [];
    const scrollX = window.scrollX, scrollY = window.scrollY;
    let usedScreenshot = false;
    // Local and fetched images in parallel; screenshot crops have to be sequential.
    const first = await Promise.all(items.map(quickRoute));
    for (let i = 0; i < items.length; i++) {
      let part = first[i];
      if (!part) {
        usedScreenshot = true;
        try { part = await viaScreenshot(items[i].el); } catch (e) { part = null; }
      }
      if (part && items[i].overlay) {
        try { part = await annotate(part, items[i].overlay); } catch (e) { /* send it unannotated */ }
      }
      if (part) {
        // The same picture twice on a page (a diagram reused by several questions) is sent once.
        const twin = out.find((o) => !o.sameAs && o.data === part.data);
        out.push(twin ? { n: items[i].n, sameAs: twin.n } : Object.assign({ n: items[i].n, alt: items[i].alt }, part));
      }
      if (onProgress) onProgress(i + 1, items.length);
    }
    if (usedScreenshot) window.scrollTo(scrollX, scrollY);
    return out;
  };
})();
