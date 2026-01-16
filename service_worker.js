const MENU_ID = "dom-copier-open";

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ID,
    title: "DOM Copier",
    contexts: ["all"]
  });
}

// Run on install/update
chrome.runtime.onInstalled.addListener(() => {
  rebuildMenus();
});

// Run on every browser startup (and often after extension reload)
chrome.runtime.onStartup.addListener(() => {
  rebuildMenus();
});

// Also run immediately when the service worker starts up
rebuildMenus();


function sendMessageToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (resp) => {
      resolve({ frameId, resp, err: chrome.runtime.lastError?.message });
    });
  });
}

function getAllFrames(tabId) {
  return new Promise((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => resolve(frames || []));
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;

  const tabId = tab.id;
  const frames = await getAllFrames(tabId);
  if (!frames.length) return;

  // Ask each frame for its last captured context timestamp.
  const queries = await Promise.all(
    frames.map((f) => sendMessageToFrame(tabId, f.frameId, { cmd: "DC_QUERY_CTX" }))
  );

  // Pick the freshest ctx among frames.
  let best = null;
  for (const q of queries) {
    const r = q.resp;
    if (!r?.ok || !r.hasCtx || typeof r.t !== "number") continue;
    if (!best || r.t > best.t) best = { frameId: q.frameId, t: r.t };
  }

  if (!best) {
    console.warn("DOM Copier: no recent right-click context found. Right-click first.");
    return;
  }

  // Tell only the best frame to open.
  await sendMessageToFrame(tabId, best.frameId, { cmd: "DC_OPEN_FROM_CTX", t: best.t });
});
