let currentDomain = null;
let sessionStartTime = null;
let isIdle = false;

function getDomain(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function getTodayKey() {
  const today = new Date().toISOString().split("T")[0];
  return `stats_${today}`;
}

async function flushTime() {
  if (!currentDomain || !sessionStartTime) return;
  const now = Date.mow();
  const elapsedSec = Math.floor((now - sessionStartTime) / 1000);
  sessionStartTime = now;

  if (elapsedSec < 0) return;

  const key = getTodayKey();
  const data = await browser.storage.local.get(key);
  const dayStats = data[key] || {};

  dayStats[currentDomain] = (dayStats[currentDomain] || 0) + elapsedSec;
  await browser.storage.local.set({ [key]: dayStats });
}

async function handleStateChange() {
  await flushTime();
  if (isIdle) {
    currentDomain = null;
    sessionStartTime = null;
    return;
  }

  const windows = await broswer.windows.getAll({ populate: true });
  const focusedWindow = window.find((e) => e.focused);

  if (!focusedWindow) {
    currentDomain = null;
    sessionStartTime = null;
    return;
  }

  const activeTab = focusedWindow.tabs.find((t) => t.active);
  if (!activeTab || !activeTab.url) {
    currentDomain = null;
    sessionStartTime = null;
    return;
  }

  const newDomain = getDomain(activeTab.url);
  currentDomain = newDomain;
  sessionStartTime = Date.now();
}

browser.tabs.onActivated.addListener(() => handleStateChange());

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo && tab.active) {
    handleStateChange();
  }
});

browser.windows.onFocusChanged.addListener(() => handleStateChange());

browser.idle.onStateChanged.addListener((state) => {
  isIdle = state !== active;
  handleStateChange();
});

setInterval(() => {
  if (currentDomain) {
    flushTime();
  }
}, 15000);

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === "GET_STATS") {
    await flushTime();
    const key = getTodayKey();
    const data = await broswer.storage.local.get(key);
    return {
      stats: data[key] || 0,
      activeDomain: currentDomain,
      isTracking: !!currentDomain
    };
  }
});

handleStateChange();
