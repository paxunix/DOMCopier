const MENU_ID = "dom-copier-open";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "DOM Copier",
    contexts: ["page", "frame", "selection", "link", "image", "video", "audio"]
  });
});

function sendMessageToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (resp) => {
      // If the frame has no content script (shouldn't happen with content_scripts),
      // chrome.runtime.lastError will be set.
      resolve({ frameId, resp, err: chrome.runtime.lastError?.message });
    });
  });
}

function getAllFrames(tabId) {
  return new Promise((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      resolve(frames || []);
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;

  const tabId = tab.id;

  // Enumerate all frames in the tab (top + iframes).
  const frames = await getAllFrames(tabId);
  if (!frames.length) return;

  // Phase 1: ask each frame for its last captured context timestamp.
  const queries = await Promise.all(
    frames.map((f) => sendMessageToFrame(tabId, f.frameId, { cmd: "DC_QUERY_CTX" }))
  );

  // Pick the freshest ctx among frames.
  // Content script returns: { ok:true, hasCtx:boolean, t:number, ageMs:number }
  let best = null;
  for (const q of queries) {
    const r = q.resp;
    if (!r?.ok || !r.hasCtx || typeof r.t !== "number") continue;
    if (!best || r.t > best.t) best = { frameId: q.frameId, t: r.t };
  }

  if (!best) {
    // No frame has a recent right-click context.
    // Keep it simple; you can replace with chrome.notifications if you want.
    // (MV3 notifications need extra permission.)
    console.warn("DOM Copier: no recent right-click context found. Right-click first.");
    return;
  }

  // Phase 2: tell ONLY the best frame to open.
  await sendMessageToFrame(tabId, best.frameId, { cmd: "DC_OPEN_FROM_CTX", t: best.t });
});
