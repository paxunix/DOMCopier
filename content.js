(() => {
  "use strict";

  // ----------------------------
  // Config
  // ----------------------------
  const CFG = {
    maxSnippetLen: 90,
    maxIdLen: 20,
    maxClassCount: 3,

    paletteZ: 2147483647,
    paletteMaxWidth: 560,
    paletteMinWidth: 320,
    paletteMaxHeight: 360,
    cursorOffset: 12,

    // Highlight overlay
    highlightZ: 2147483646,
    highlightRadiusPx: 10,
    highlightPaddingPx: 2,

    // Context freshness
    ctxTtlMs: 30_000
  };

  // ----------------------------
  // Utilities
  // ----------------------------
  const isElement = (n) => n && n.nodeType === 1;

  const truncate = (s, n) => {
    s = String(s ?? "");
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + "…";
  };

  const snippet = (value) => truncate(String(value ?? ""), CFG.maxSnippetLen);

  const collapsedText = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const trimmedText = (el) => (el?.textContent ?? "").trim();
  const rawText = (el) => el?.textContent ?? "";

  const elIdentifier = (el) => {
    const tag = (el.tagName || "element").toLowerCase();

    let id = "";
    if (el.id) id = "#" + truncate(el.id, CFG.maxIdLen);

    let classes = "";
    if (el.classList && el.classList.length) {
      classes = Array.from(el.classList)
        .filter(Boolean)
        .slice(0, CFG.maxClassCount)
        .map((c) => "." + c)
        .join("");
    }

    const ident = tag + id + classes;
    return ident || tag;
  };

  async function copyToClipboard(text) {
    const value = String(text ?? "");

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function clampToViewport(x, y, w, h, pad = 8) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x,
      ny = y;

    if (nx + w + pad > vw) nx = vw - w - pad;
    if (ny + h + pad > vh) ny = vh - h - pad;
    if (nx < pad) nx = pad;
    if (ny < pad) ny = pad;

    return { x: nx, y: ny };
  }

  // Choose target using hit-testing
  function pickTargetAtPoint(clientX, clientY) {
    const list = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(clientX, clientY)
      : [];

    for (const n of list) {
      if (isElement(n)) return n;
    }
    const one = document.elementFromPoint?.(clientX, clientY);
    return isElement(one) ? one : null;
  }

  // Build ancestor chain from target -> ... -> body (inclusive)
  function buildAncestorPath(target) {
    const out = [];
    let cur = target;
    while (cur && isElement(cur)) {
      out.push(cur);
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    // If somehow body wasn't reached but exists, add it.
    if (document.body && out[out.length - 1] !== document.body) out.push(document.body);
    return out;
  }

  // ----------------------------
  // Styles
  // ----------------------------
  const ensureStyles = (() => {
    let installed = false;
    return () => {
      if (installed) return;
      installed = true;

      const style = document.createElement("style");
      style.id = "__dom_copier_styles__";
      style.textContent = `
        .__dc_backdrop__ {
          position: fixed;
          inset: 0;
          z-index: ${CFG.paletteZ};
          background: rgba(0,0,0,0.12);
        }

        .__dc_palette__ {
          position: fixed;
          z-index: ${CFG.paletteZ + 1};
          max-width: ${CFG.paletteMaxWidth}px;
          min-width: ${CFG.paletteMinWidth}px;
          max-height: ${CFG.paletteMaxHeight}px;
          border-radius: 14px;
          background: #fff;
          color: #111;
          box-shadow: 0 18px 50px rgba(0,0,0,0.35);
          overflow: hidden;
          font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }

        .__dc_header__ {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(0,0,0,0.10);
          user-select: none;
        }

        .__dc_title__ { font-size: 12px; opacity: 0.85; }

        .__dc_keys__ {
          display: flex;
          gap: 6px;
          align-items: center;
          opacity: 0.75;
          font-size: 11px;
        }

        .__dc_kbd__ {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          background: rgba(0,0,0,0.06);
          padding: 2px 6px;
          border-radius: 7px;
          border: 1px solid rgba(0,0,0,0.08);
        }

        .__dc_list__ {
          overflow: auto;
          max-height: ${CFG.paletteMaxHeight - 44}px;
          padding: 0 8px 10px;
        }

        .__dc_sticky__{
          position: sticky;
          top: 0;
          z-index: 3;
          background: #fff;
          border-bottom: 1px solid rgba(0,0,0,0.10);
          padding: 8px 6px;
          margin: 0;
          font-size: 12px;
          opacity: 0.92;
          user-select: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .__dc_sticky__::before{
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(0,0,0,0.20);
          flex: 0 0 auto;
        }

        .__dc_section__ {
          margin: 10px 0 6px;
          padding: 0 6px;
          font-size: 12px;
          opacity: 0.75;
          user-select: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .__dc_section__::before{
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(0,0,0,0.20);
          flex: 0 0 auto;
        }

        .__dc_item__ {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px;
          border-radius: 12px;
          margin: 3px 0 3px 16px;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .__dc_item__:hover { background: rgba(0,0,0,0.04); }
        .__dc_item__[data-active="true"] {
          background: rgba(0,0,0,0.06);
          border-color: rgba(0,0,0,0.12);
          box-shadow: 0 0 0 3px rgba(0,0,0,0.06);
        }

        .__dc_item_top__ {
          display: flex;
          gap: 10px;
          align-items: baseline;
          justify-content: space-between;
        }
        .__dc_kind__ { font-weight: 600; font-size: 12px; }
        .__dc_preview__ {
          font-size: 12px;
          opacity: 0.82;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .__dc_hint__ { font-size: 11px; opacity: 0.65; margin-top: 2px; user-select: none; }

        .__dc_hl__ {
          position: fixed;
          left: 0;
          top: 0;
          width: 0;
          height: 0;
          z-index: ${CFG.highlightZ};
          pointer-events: none;
          border-radius: ${CFG.highlightRadiusPx}px;
          border: 3px solid rgba(255, 179, 0, 0.98);
          box-shadow:
            0 0 0 10px rgba(255, 179, 0, 0.55),
            0 10px 30px rgba(0,0,0,0.22);
          background: rgba(255, 230, 120, 0.35);
          opacity: 0;
          transition: opacity 80ms linear;
        }
        .__dc_hl__[data-on="true"] { opacity: 1; }
      `;
      document.documentElement.appendChild(style);
    };
  })();

  // ----------------------------
  // Payload computation
  // ----------------------------
  function payloadFor(el, action) {
    switch (action.kind) {
      case "collapsed": return collapsedText(el);
      case "trimmed": return trimmedText(el);
      case "raw": return rawText(el);
      case "innerHTML": return el?.innerHTML ?? "";
      case "outerHTML": return el?.outerHTML ?? "";
      case "attr":
        return (action.attr && el?.getAttribute) ? (el.getAttribute(action.attr) ?? "") : "";
      default: return "";
    }
  }

  function buildActionsForElement(el) {
    const actions = [
      { kind: "collapsed", label: "Collapsed text", preview: collapsedText(el) },
      { kind: "trimmed", label: "Trimmed text", preview: trimmedText(el) },
      { kind: "raw", label: "Raw text", preview: rawText(el) },
      { kind: "innerHTML", label: "innerHTML", preview: el?.innerHTML ?? "" },
      { kind: "outerHTML", label: "outerHTML", preview: el?.outerHTML ?? "" }
    ];

    if (el?.attributes?.length) {
      for (const a of Array.from(el.attributes)) {
        if (!a?.name) continue;
        actions.push({
          kind: "attr",
          attr: a.name,
          label: `attr ${a.name}=`,
          preview: a.value ?? ""
        });
      }
    }
    return actions;
  }

  // ----------------------------
  // Highlight overlay manager
  // ----------------------------
  const highlight = (() => {
    let node = null;
    let currentEl = null;

    function ensure() {
      if (node) return node;
      node = document.createElement("div");
      node.className = "__dc_hl__";
      node.dataset.on = "false";
      document.documentElement.appendChild(node);
      return node;
    }

    function hide() {
      if (!node) return;
      node.dataset.on = "false";
      currentEl = null;
    }

    function updateNow() {
      if (!node || !currentEl) return;

      const r = currentEl.getBoundingClientRect();
      const pad = CFG.highlightPaddingPx;

      if (r.width <= 0 || r.height <= 0) {
        hide();
        return;
      }

      node.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
      node.style.width = `${r.width + pad * 2}px`;
      node.style.height = `${r.height + pad * 2}px`;
      node.dataset.on = "true";
    }

    function showFor(el) {
      if (!isElement(el)) {
        hide();
        return;
      }
      ensure();
      currentEl = el;
      updateNow();
    }

    return { showFor, hide, updateNow };
  })();

  // ----------------------------
  // UI: command palette
  // ----------------------------
  let openState = null;

  function closePalette() {
    if (!openState) return;
    const { backdrop, palette } = openState;
    openState = null;

    highlight.hide();

    backdrop?.remove();
    palette?.remove();
    document.removeEventListener("keydown", onGlobalKeyDown, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize, true);
  }

  function onScrollOrResize() {
    if (!openState) return;
    highlight.updateNow();
  }

  function currentSectionFromScroll() {
    if (!openState) return null;
    const { list, sticky, sections } = openState;
    if (!sections.length) return null;

    const st = list.scrollTop;
    const stickyH = sticky.offsetHeight || 0;
    const threshold = st + stickyH + 1;

    let current = sections[0];
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].node.offsetTop <= threshold) current = sections[i];
      else break;
    }
    return current;
  }

  function updateStickyFromScroll() {
    const current = currentSectionFromScroll();
    if (!current || !openState) return;
    const txt = current.node.textContent || "";
    if (openState.sticky.textContent !== txt) openState.sticky.textContent = txt;
  }

  function setActiveIndex(idx) {
    if (!openState) return;
    const items = openState.items;
    if (!items.length) return;

    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    openState.activeIndex = clamped;

    for (let i = 0; i < items.length; i++) {
      items[i].node.dataset.active = (i === clamped) ? "true" : "false";
    }

    items[clamped].node.scrollIntoView({ block: "nearest" });

    updateStickyFromScroll();
    highlight.showFor(items[clamped].el);
  }

  function activateIndex(idx) {
    if (!openState) return;
    const item = openState.items[idx];
    if (!item) return;
    void activateItem(item);
  }

  async function activateItem(item) {
    const el = item.el;
    const action = item.action;

    try { el?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } catch (_) {}

    const text = payloadFor(el, action);
    await copyToClipboard(text);

    highlight.showFor(el);
    closePalette();
  }

  function onGlobalKeyDown(e) {
    if (!openState) return;

    const key = e.key;

    if (key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      return;
    }

    if (key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex(openState.activeIndex + 1);
      return;
    }

    if (key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex(openState.activeIndex - 1);
      return;
    }

    if (key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      activateIndex(openState.activeIndex);
      return;
    }

    if (key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex(0);
      return;
    }

    if (key === "End") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex(openState.items.length - 1);
      return;
    }
  }

  function openPaletteAt({ clientX, clientY, pathEls }) {
    if (openState) return;
    ensureStyles();

    const backdrop = document.createElement("div");
    backdrop.className = "__dc_backdrop__";
    backdrop.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
    }, true);

    const palette = document.createElement("div");
    palette.className = "__dc_palette__";
    palette.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "__dc_header__";

    const title = document.createElement("div");
    title.className = "__dc_title__";
    title.textContent = "DOM Copier";

    const keys = document.createElement("div");
    keys.className = "__dc_keys__";
    keys.innerHTML = `
      <span class="__dc_kbd__">↑</span><span class="__dc_kbd__">↓</span>
      <span class="__dc_kbd__">Enter</span>
      <span class="__dc_kbd__">Esc</span>
    `;

    header.appendChild(title);
    header.appendChild(keys);

    const list = document.createElement("div");
    list.className = "__dc_list__";

    const sticky = document.createElement("div");
    sticky.className = "__dc_sticky__";
    sticky.textContent = "";
    list.appendChild(sticky);

    const sections = [];
    const items = [];

    for (const el of pathEls) {
      const section = document.createElement("div");
      section.className = "__dc_section__";
      section.textContent = elIdentifier(el);
      list.appendChild(section);
      sections.push({ el, node: section });

      section.addEventListener("mouseenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        highlight.showFor(el);
      });
      section.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, true);
      section.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        highlight.showFor(el);
      });

      const actions = buildActionsForElement(el);
      for (const action of actions) {
        const node = document.createElement("div");
        node.className = "__dc_item__";
        node.dataset.active = "false";

        const top = document.createElement("div");
        top.className = "__dc_item_top__";

        const kind = document.createElement("div");
        kind.className = "__dc_kind__";
        kind.textContent = action.label;

        const preview = document.createElement("div");
        preview.className = "__dc_preview__";
        preview.textContent = snippet(action.preview);

        top.appendChild(kind);
        top.appendChild(preview);

        const hint = document.createElement("div");
        hint.className = "__dc_hint__";
        hint.textContent = "Click or press Enter to copy";

        node.appendChild(top);
        node.appendChild(hint);

        node.addEventListener("mouseenter", () => {
          const idx = items.findIndex((it) => it.node === node);
          if (idx >= 0) setActiveIndex(idx);
        });

        node.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, true);

        node.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = items.findIndex((it) => it.node === node);
          if (idx >= 0) activateIndex(idx);
        });

        list.appendChild(node);
        items.push({ el, action, node });
      }
    }

    sticky.addEventListener("mouseenter", () => {
      const current = currentSectionFromScroll();
      if (current) highlight.showFor(current.el);
    });
    sticky.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = currentSectionFromScroll();
      if (current) highlight.showFor(current.el);
    });

    palette.appendChild(header);
    palette.appendChild(list);

    document.documentElement.appendChild(backdrop);
    document.documentElement.appendChild(palette);

    list.addEventListener("scroll", updateStickyFromScroll, { passive: true });

    const startX = clientX + CFG.cursorOffset;
    const startY = clientY + CFG.cursorOffset;

    palette.style.left = "0px";
    palette.style.top = "0px";

    const w = palette.offsetWidth;
    const h = palette.offsetHeight;
    const pos = clampToViewport(startX, startY, w, h);
    palette.style.left = `${pos.x}px`;
    palette.style.top = `${pos.y}px`;

    palette.focus();

    openState = { backdrop, palette, list, sticky, sections, items, activeIndex: 0 };

    document.addEventListener("keydown", onGlobalKeyDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize, true);

    updateStickyFromScroll();
    if (items.length) setActiveIndex(0);
  }

  // ----------------------------
  // Context capture (per-frame): store ONLY coordinates + timestamp
  // ----------------------------
  let lastCtx = null; // { t, clientX, clientY }

  function captureContextmenu(e) {
    // Observe only; do not prevent default.
    lastCtx = {
      t: Date.now(),
      clientX: e.clientX,
      clientY: e.clientY
    };
  }

  window.addEventListener("contextmenu", captureContextmenu, { capture: true, passive: true });
  window.addEventListener(
    "mousedown",
    (e) => { if (e.button === 2) captureContextmenu(e); },
    { capture: true, passive: true }
  );

  // ----------------------------
  // Messaging API for service worker
  // ----------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg?.cmd === "DC_QUERY_CTX") {
        const now = Date.now();
        const hasCtx = !!lastCtx && (now - lastCtx.t) <= CFG.ctxTtlMs;
        sendResponse({
          ok: true,
          hasCtx,
          t: hasCtx ? lastCtx.t : 0,
          ageMs: hasCtx ? (now - lastCtx.t) : 0
        });
        return;
      }

      if (msg?.cmd === "DC_OPEN_FROM_CTX") {
        const now = Date.now();
        const hasCtx = !!lastCtx && (now - lastCtx.t) <= CFG.ctxTtlMs;

        // Only the SW-chosen frame should open.
        if (!hasCtx || (typeof msg.t === "number" && lastCtx.t !== msg.t)) {
          sendResponse({ ok: true, opened: false });
          return;
        }

        const target = pickTargetAtPoint(lastCtx.clientX, lastCtx.clientY);
        if (!target) {
          sendResponse({ ok: true, opened: false, reason: "no-target" });
          return;
        }

        const pathEls = buildAncestorPath(target);
        openPaletteAt({
          clientX: lastCtx.clientX,
          clientY: lastCtx.clientY,
          pathEls
        });

        sendResponse({ ok: true, opened: true });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
      return;
    }
  });
})();
