// ==UserScript==
// @name         DOM Copier
// @namespace    https://example.local/
// @version      2
// @description  Ctrl/Cmd+LeftClick opens a command-palette menu to copy various DOM contents from the event path.
// @match        *://*/*
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  "use strict";

  // ----------------------------
  // Config
  // ----------------------------
  const CFG = {
    trigger: (e) =>
      e.button === 0 && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey,

    maxSnippetLen: 90,
    maxIdLen: 20,
    maxClassCount: 3,

    paletteZ: 2147483647,
    paletteMaxWidth: 560,
    paletteMinWidth: 320,
    paletteMaxHeight: 360,
    cursorOffset: 12,

    // Highlight pulse
    pulseMs: 1500,

    // Key repeat niceties
    scrollIntoViewBlock: "nearest",
    scrollIntoViewInline: "nearest",
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
    // tag#id.class1.class2
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

    // Modern API (best effort)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      // ignore
    }

    // Preferred fallback
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(value, "text");
        return true;
      }
    } catch (_) {
      // ignore
    }

    // Last-ditch fallback
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
    let nx = x, ny = y;

    if (nx + w + pad > vw) nx = vw - w - pad;
    if (ny + h + pad > vh) ny = vh - h - pad;
    if (nx < pad) nx = pad;
    if (ny < pad) ny = pad;

    return { x: nx, y: ny };
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
        /* Backdrop (outside click closes) */
        .__dc_backdrop__ {
          position: fixed;
          inset: 0;
          z-index: ${CFG.paletteZ};
          background: rgba(0,0,0,0.12);
        }

        /* Palette container */
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

        .__dc_title__ {
          font-size: 12px;
          opacity: 0.85;
        }

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
          padding: 8px 8px 10px;
        }

        .__dc_section__ {
          margin: 8px 0 6px;
          padding: 0 6px;
          font-size: 12px;
          opacity: 0.75;
          user-select: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .__dc_section__::before {
          content: "";
          flex: 0 0 auto;
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(0,0,0,0.20);
        }

        .__dc_item__ {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px;
          border-radius: 12px;
          margin: 3px 0;
          cursor: pointer;
          border: 1px solid transparent;
          /* Indent items so headers read like group labels */
          margin-left: 16px;
        }

        .__dc_item__:hover {
          background: rgba(0,0,0,0.04);
        }

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

        .__dc_kind__ {
          font-weight: 600;
          font-size: 12px;
        }

        .__dc_preview__ {
          font-size: 12px;
          opacity: 0.82;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .__dc_hint__ {
          font-size: 11px;
          opacity: 0.65;
          margin-top: 2px;
          user-select: none;
        }

        /* Noticeable pulse: outline + "border-like" box-shadow + inset background flash, then shrink/fade */
        @keyframes __dc_pulse__ {
          0% {
            outline: 0px solid rgba(255, 179, 0, 0);
            box-shadow:
              0 0 0 0 rgba(255, 179, 0, 0),
              inset 0 0 0 0 rgba(255, 230, 120, 0);
          }
          18% {
            outline: 3px solid rgba(255, 179, 0, 0.98);
            box-shadow:
              0 0 0 10px rgba(255, 179, 0, 0.65),
              inset 0 0 0 9999px rgba(255, 230, 120, 0.45);
          }
          40% {
            outline: 3px solid rgba(255, 179, 0, 0.90);
            box-shadow:
              0 0 0 6px rgba(255, 179, 0, 0.55),
              inset 0 0 0 9999px rgba(255, 230, 120, 0.36);
          }
          100% {
            outline: 0px solid rgba(255, 179, 0, 0);
            box-shadow:
              0 0 0 0 rgba(255, 179, 0, 0),
              inset 0 0 0 0 rgba(255, 230, 120, 0);
          }
        }

        .__dc_pulse__ {
          animation: __dc_pulse__ ${CFG.pulseMs}ms ease-out forwards !important;
        }
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
      case "attr": return (action.attr && el?.getAttribute) ? (el.getAttribute(action.attr) ?? "") : "";
      default: return "";
    }
  }

  function buildActionsForElement(el) {
    const actions = [
      { kind: "collapsed", label: "Collapsed text", preview: collapsedText(el) },
      { kind: "trimmed", label: "Trimmed text", preview: trimmedText(el) },
      { kind: "raw", label: "Raw text", preview: rawText(el) },
      { kind: "innerHTML", label: "innerHTML", preview: el?.innerHTML ?? "" },
      { kind: "outerHTML", label: "outerHTML", preview: el?.outerHTML ?? "" },
    ];

    // Every attribute present
    if (el?.attributes?.length) {
      for (const a of Array.from(el.attributes)) {
        if (!a?.name) continue;
        actions.push({
          kind: "attr",
          attr: a.name,
          label: `attr ${a.name}=`,
          preview: a.value ?? "",
        });
      }
    }

    return actions;
  }

  // ----------------------------
  // UI: command palette
  // ----------------------------
  let openState = null; // { backdrop, palette, items: [{el, action, node, sectionNode}], activeIndex }

  function closePalette() {
    if (!openState) return;
    const { backdrop, palette } = openState;
    openState = null;
    backdrop?.remove();
    palette?.remove();
    document.removeEventListener("keydown", onGlobalKeyDown, true);
  }

  function pulseHighlight(el) {
    if (!isElement(el)) return;

    // Re-trigger animation reliably
    el.classList.remove("__dc_pulse__");
    // Force reflow
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;
    el.classList.add("__dc_pulse__");

    window.setTimeout(() => {
      el.classList.remove("__dc_pulse__");
    }, CFG.pulseMs + 60);
  }

  // Debounced preview pulsing for rapid keyboard repeat / hover movement.
  // Coalesces bursts into a single pulse after a short pause.
  const previewPulse = (() => {
    let t = null;
    let lastEl = null;
    const delay = 70; // ms

    return (el) => {
      if (!isElement(el)) return;
      lastEl = el;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        pulseHighlight(lastEl);
      }, delay);
    };
  })();

  function setActiveIndex(idx) {
    if (!openState) return;
    const items = openState.items;
    if (!items.length) return;

    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    openState.activeIndex = clamped;

    for (let i = 0; i < items.length; i++) {
      items[i].node.dataset.active = (i === clamped) ? "true" : "false";
    }

    // Keep active group header + item visible, so the user always sees the element identifier.
    if (items[clamped].sectionNode) {
      items[clamped].sectionNode.scrollIntoView({ block: "nearest" });
    }
    items[clamped].node.scrollIntoView({ block: "nearest" });

    // Preview highlight: hovering/cursoring indicates which element the action would apply to
    previewPulse(items[clamped].el);
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

    try {
      el?.scrollIntoView?.({ block: CFG.scrollIntoViewBlock, inline: CFG.scrollIntoViewInline });
    } catch (_) {}

    const text = payloadFor(el, action);
    await copyToClipboard(text);

    pulseHighlight(el);
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
    ensureStyles();

    // Backdrop handles outside click close
    const backdrop = document.createElement("div");
    backdrop.className = "__dc_backdrop__";
    backdrop.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
    }, true);

    // Palette
    const palette = document.createElement("div");
    palette.className = "__dc_palette__";
    palette.tabIndex = -1; // focusable

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

    const items = [];
    for (const el of pathEls) {
      const section = document.createElement("div");
      section.className = "__dc_section__";
      section.textContent = elIdentifier(el);
      list.appendChild(section);

      // Hovering/clicking group header previews which element actions apply to
      section.addEventListener("mousemove", (e) => {
        e.preventDefault();
        e.stopPropagation();
        previewPulse(el);
      });
      section.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, true);
      section.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        previewPulse(el);
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
        hint.textContent = "Click or press Enter to copy + highlight";

        node.appendChild(top);
        node.appendChild(hint);

        node.addEventListener("mousemove", () => {
          // Hover moves active selection (and previews via setActiveIndex)
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
        items.push({ el, action, node, sectionNode: section });
      }
    }

    palette.appendChild(header);
    palette.appendChild(list);

    document.documentElement.appendChild(backdrop);
    document.documentElement.appendChild(palette);

    // Position near cursor; clamp after measuring
    const startX = clientX + CFG.cursorOffset;
    const startY = clientY + CFG.cursorOffset;

    palette.style.left = "0px";
    palette.style.top = "0px";

    requestAnimationFrame(() => {
      const r = palette.getBoundingClientRect();
      const pos = clampToViewport(startX, startY, r.width, r.height);
      palette.style.left = `${pos.x}px`;
      palette.style.top = `${pos.y}px`;
      palette.focus();
      setActiveIndex(0);
    });

    document.addEventListener("keydown", onGlobalKeyDown, true);

    openState = {
      backdrop,
      palette,
      items,
      activeIndex: 0,
    };
  }

  // ----------------------------
  // Main listener (robust)
  // ----------------------------
  function onMouseDown(e) {
    if (!CFG.trigger(e)) return;
    if (openState) return;

    // Capture phase for robustness (sites that stop propagation)
    // Still use composedPath ordering (target -> ancestors)
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const els = path.filter(isElement);

    if (!els.length) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    openPaletteAt({ clientX: e.clientX, clientY: e.clientY, pathEls: els });
  }

  window.addEventListener("mousedown", onMouseDown, { capture: true, passive: false });
})();
