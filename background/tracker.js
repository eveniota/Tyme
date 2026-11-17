let currentDomain = null;
let sessionStartTime = null;
let isIdle = false;

// 1. Helper: Clean URL to Domain
function getDomain(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Ignore internal browser pages (about:config, moz-extension://, file://)
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// 2. Helper: Get today's storage key (e.g. "stats_2026-11-17")
function getTodayKey() {
  const today = new Date().toISOString().split("T")[0];
  return `stats_${today}`;
}

// 3. Flush elapsed time to browser.storage.local
async function flushTime() {
  if (!currentDomain || !sessionStartTime) return;

  const now = Date.now();
  const elapsedSec = Math.floor((now - sessionStartTime) / 1000);
  sessionStartTime = now;

  if (elapsedSec <= 0) return;

  const key = getTodayKey();
  const data = await browser.storage.local.get(key);
  const dayStats = data[key] || {};

  dayStats[currentDomain] = (dayStats[currentDomain] || 0) + elapsedSec;
  await browser.storage.local.set({ [key]: dayStats });
  console.log(`[Tyme] Flushed ${elapsedSec}s to ${currentDomain}`);
}

// 4. Update the active domain state
async function handleStateChange() {
  await flushTime();

  if (isIdle) {
    currentDomain = null;
    sessionStartTime = null;
    console.log("[Tyme] Idle state active - paused");
    broadcastState();
    return;
  }

  // Use lastFocusedWindow so clicking the extension popup doesn't cancel tracking!
  const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];

  if (!activeTab || !activeTab.url) {
    currentDomain = null;
    sessionStartTime = null;
    broadcastState();
    return;
  }

  const newDomain = getDomain(activeTab.url);
  currentDomain = newDomain;
  sessionStartTime = newDomain ? Date.now() : null;

  console.log(`[Tyme] Active domain: ${currentDomain || "None (Internal Page)"}`);
  broadcastState();
}

// 5. Notify popup if it is open
function broadcastState() {
  browser.runtime.sendMessage({
    type: "STATE_CHANGED",
    activeDomain: currentDomain,
    isTracking: !!currentDomain
  }).catch(() => {
    // Expected error when popup is closed (no listener)
  });
}

// --- Browser Event Listeners ---

// Tab switch in window
browser.tabs.onActivated.addListener(() => handleStateChange());

// Tab URL change
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    handleStateChange();
  }
});

// Window focus change (switching between apps or split windows)
browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    console.log("[Tyme] Firefox lost focus to another app");
    await flushTime();
    currentDomain = null;
    sessionStartTime = null;
    broadcastState();
  } else {
    handleStateChange();
  }
});

// Idle detection (user away from computer)
browser.idle.onStateChanged.addListener((state) => {
  isIdle = state !== "active";
  handleStateChange();
});

// Auto-flush every 15s to keep disk fresh
setInterval(() => {
  if (currentDomain) {
    flushTime();
  }
}, 15000);

// --- Communication with Popup ---
browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === "GET_STATS") {
    await flushTime();
    const key = getTodayKey();
    const data = await browser.storage.local.get(key);
    return {
      stats: data[key] || {},
      activeDomain: currentDomain,
      isTracking: !!currentDomain
    };
  }
});

// Initial boot
handleStateChange();
