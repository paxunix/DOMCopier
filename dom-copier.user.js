// ==UserScript==
// @name         Ctrl/Cmd+Click DOM Path Copier
// @namespace    https://example.local/
// @version      0.1.0
// @description  Ctrl/Cmd+LeftClick shows a dialog with copy options for elements in the event path.
// @match        *://*/*
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  "use strict";

  // ----------------------------
  // Config (easy to extend)
  // ----------------------------
  const CFG = {
    trigger: (e) =>
      e.button === 0 && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey,
    maxSnippetLen: 80,
    maxOptgroupLabelLen: 48,
    maxIdLen: 18,
    maxClassCount: 3,
    highlightMs: 1500,
    dialogZIndex: 2147483647,
    dialogMaxWidthPx: 520,
    dialogMinWidthPx: 280,
    cursorOffsetPx: 12,
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

  const collapsedText = (el) => {
    const t = el?.textContent ?? "";
    // Trim + collapse all whitespace runs to a single space
    return t.replace(/\s+/g, " ").trim();
  };

  const trimmedText = (el) => (el?.textContent ?? "").trim();

  const rawText = (el) => el?.textContent ?? "";

  const elIdentifier = (el) => {
    // tag#id.class1.class2 (lightweight, not too long)
    const tag = (el.tagName || "element").toLowerCase();

    let id = "";
    if (el.id) id = "#" + truncate(el.id, CFG.maxIdLen);

    let classes = "";
    if (el.classList && el.classList.length) {
      const cls = Array.from(el.classList)
        .filter(Boolean)
        .slice(0, CFG.maxClassCount)
        .map((c) => "." + c);
      classes = cls.join("");
    }

    const base = truncate(tag + id + classes, CFG.maxOptgroupLabelLen);
    return base || tag;
  };

  const snippetPreview = (value) =>
    truncate(String(value ?? ""), CFG.maxSnippetLen);

  const ensureStyles = (() => {
    let installed = false;
    return () => {
      if (installed) return;
      installed = true;

      const style = document.createElement("style");
      style.id = "__gm_dom_path_copier_styles__";
      style.textContent = `
        dialog.__gm_dom_path_copier__ {
          position: fixed;
          margin: 0;
          padding: 0;
          border: none;
          border-radius: 10px;
          box-shadow: 0 12px 36px rgba(0,0,0,.35);
          max-width: ${CFG.dialogMaxWidthPx}px;
          min-width: ${CFG.dialogMinWidthPx}px;
          z-index: ${CFG.dialogZIndex};
          overflow: visible;
        }

        dialog.__gm_dom_path_copier__::backdrop {
          background: rgba(0,0,0,0.15);
        }

        .__gm_dpc_frame__ {
          font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          padding: 10px 12px 12px;
          background: white;
          color: #111;
          border-radius: 10px;
        }

        .__gm_dpc_title__ {
          font-size: 12px;
          opacity: 0.78;
          margin: 0 0 8px;
          user-select: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .__gm_dpc_title__ code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          background: rgba(0,0,0,0.06);
          padding: 2px 6px;
          border-radius: 6px;
        }

        select.__gm_dpc_select__ {
          width: 100%;
          box-sizing: border-box;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid rgba(0,0,0,0.18);
          background: white;
          color: #111;
          outline: none;
        }

        select.__gm_dpc_select__:focus {
          border-color: rgba(0,0,0,0.35);
          box-shadow: 0 0 0 3px rgba(0,0,0,0.08);
        }

        .__gm_dpc_hint__ {
          margin-top: 8px;
          font-size: 11px;
          opacity: 0.7;
          user-select: none;
        }

        /* Highlight animation: outline + background, fades out */
        @keyframes __gm_dpc_flash__ {
          0%   { outline-color: rgba(255, 215, 0, 0.95); background-color: rgba(255, 215, 0, 0.28); }
          20%  { outline-color: rgba(255, 215, 0, 0.95); background-color: rgba(255, 215, 0, 0.24); }
          100% { outline-color: rgba(255, 215, 0, 0);    background-color: rgba(255, 215, 0, 0); }
        }

        .__gm_dpc_flash__ {
          outline: 2px solid rgba(255, 215, 0, 0.95) !important;
          animation: __gm_dpc_flash__ ${CFG.highlightMs}ms ease forwards !important;
          /* Background highlight can be visually subtle depending on element; that's OK. */
        }
      `;
      document.documentElement.appendChild(style);
    };
  })();

  async function copyToClipboard(text) {
    const value = String(text ?? "");

    // Try modern API first (often works because we're inside a click gesture).
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      // fall through
    }

    // Tampermonkey/Violentmonkey/Greasemonkey grant fallback
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(value, "text");
        return true;
      }
    } catch (_) {
      // fall through
    }

    // Last-ditch fallback (may fail on modern pages)
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

  function flashElement(el) {
    if (!isElement(el)) return;

    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch (_) {
      // ignore
    }

    el.classList.add("__gm_dpc_flash__");
    window.setTimeout(() => {
      el.classList.remove("__gm_dpc_flash__");
    }, CFG.highlightMs + 80);
  }

  function getPayload(el, kind, attrName) {
    switch (kind) {
      case "collapsed":
        return collapsedText(el);
      case "trimmed":
        return trimmedText(el);
      case "raw":
        return rawText(el);
      case "innerHTML":
        return el?.innerHTML ?? "";
      case "outerHTML":
        return el?.outerHTML ?? "";
      case "attr":
        return (attrName && el?.getAttribute) ? (el.getAttribute(attrName) ?? "") : "";
      default:
        return "";
    }
  }

  function clampToViewport(x, y, w, h, padding = 8) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nx = x;
    let ny = y;

    if (nx + w + padding > vw) nx = vw - w - padding;
    if (ny + h + padding > vh) ny = vh - h - padding;
    if (nx < padding) nx = padding;
    if (ny < padding) ny = padding;

    return { x: nx, y: ny };
  }

  // ----------------------------
  // Dialog creation
  // ----------------------------
  let isOpen = false;

  function buildDialog({ clientX, clientY, pathEls }) {
    ensureStyles();

    const dialog = document.createElement("dialog");
    dialog.className = "__gm_dom_path_copier__";
    dialog.style.left = "0px";
    dialog.style.top = "0px";

    const frame = document.createElement("div");
    frame.className = "__gm_dpc_frame__";

    const title = document.createElement("div");
    title.className = "__gm_dpc_title__";
    title.innerHTML = `
      <span>Copy from event path</span>
      <code>Esc</code>
    `;

    const select = document.createElement("select");
    select.className = "__gm_dpc_select__";
    select.size = 14; // makes browsing way nicer than a collapsed dropdown
    select.setAttribute("aria-label", "Copy options");

    // Placeholder first option
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose something to copy…";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    // For each element in path, create an optgroup with content-type options
    pathEls.forEach((el, idx) => {
      const og = document.createElement("optgroup");
      og.label = elIdentifier(el);

      // Content types (easy to extend)
      const addOption = (kind, label, payloadPreview, extra = {}) => {
        const opt = document.createElement("option");
        const encoded = {
          i: idx,        // element index in pathEls
          k: kind,       // payload kind
          a: extra.attr ?? null,
        };
        opt.value = JSON.stringify(encoded);
        opt.textContent = `${label}: ${snippetPreview(payloadPreview)}`;
        og.appendChild(opt);
      };

      addOption("collapsed", "Collapsed text", collapsedText(el));
      addOption("trimmed", "Trimmed text", trimmedText(el));
      addOption("raw", "Raw text", rawText(el));
      addOption("innerHTML", "innerHTML", el.innerHTML ?? "");
      addOption("outerHTML", "outerHTML", el.outerHTML ?? "");

      // Every attribute present on the element (one option per attribute)
      if (el && el.attributes && el.attributes.length) {
        for (const attr of Array.from(el.attributes)) {
          const name = attr?.name;
          if (!name) continue;
          const val = attr?.value ?? "";
          // type name = attribute name, snippet = value snippet
          const opt = document.createElement("option");
          opt.value = JSON.stringify({ i: idx, k: "attr", a: name });
          opt.textContent = `${name}: ${snippetPreview(val)}`;
          og.appendChild(opt);
        }
      }

      select.appendChild(og);
    });

    const hint = document.createElement("div");
    hint.className = "__gm_dpc_hint__";
    hint.textContent = "Copies full content to clipboard and briefly highlights the element.";

    frame.appendChild(title);
    frame.appendChild(select);
    frame.appendChild(hint);
    dialog.appendChild(frame);

    // Close on outside click (backdrop click)
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });

    // On close, cleanup
    dialog.addEventListener("close", () => {
      isOpen = false;
      dialog.remove();
    });

    // Selection handler
    select.addEventListener("click", async () => {
      const v = select.value;
      if (!v) return;

      let data;
      try {
        data = JSON.parse(v);
      } catch {
        dialog.close();
        return;
      }

      const el = pathEls[data.i];
      const payload = getPayload(el, data.k, data.a);

      flashElement(el);
      await copyToClipboard(payload);

      dialog.close();
    });

    // Cancel event triggers on Esc; allow it to close.
    dialog.addEventListener("cancel", () => {
      // default behavior closes; nothing else needed
    });

    // Mount + show
    document.documentElement.appendChild(dialog);

    // Position near cursor; clamp after layout
    const startX = clientX + CFG.cursorOffsetPx;
    const startY = clientY + CFG.cursorOffsetPx;

    dialog.showModal();

    // After it's open, measure and clamp
    requestAnimationFrame(() => {
      const rect = dialog.getBoundingClientRect();
      const { x, y } = clampToViewport(startX, startY, rect.width, rect.height);
      dialog.style.left = `${x}px`;
      dialog.style.top = `${y}px`;
      // Focus select for immediate keyboard navigation
      select.focus();
    });

    return dialog;
  }

  // ----------------------------
  // Main event listener
  // ----------------------------
  function onMouseDown(e) {
    // Use mousedown so we beat site click handlers; still treat it as a "click-like" gesture.
    if (!CFG.trigger(e)) return;
    if (isOpen) return;

    // Robust: capture phase listener catches even if page stops propagation.
    // But we still build bubble-like ordering from composedPath()
    const path = (typeof e.composedPath === "function" ? e.composedPath() : []);
    const els = path.filter(isElement);

    if (!els.length) return;

    // Prevent default + stop page handling
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    isOpen = true;
    buildDialog({ clientX: e.clientX, clientY: e.clientY, pathEls: els });
  }

  // Capture phase for robustness, but display ordering remains target->ancestors
  window.addEventListener("mousedown", onMouseDown, { capture: true, passive: false });
})();
