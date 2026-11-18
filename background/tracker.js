let currentDomain = null;
let sessionStartTime = null;
let isIdle = false;

function getCurrentTimeSlot() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    hour: now.getHours()
  };
}

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

  const now = Date.now();
  const elapsedSec = Math.floor((now - sessionStartTime) / 1000);
  sessionStartTime = now;

  if (elapsedSec <= 0) return;

  const { date, hour } = getCurrentTimeSlot();
  const key = `stats_${date}`;
  const data = await browser.storage.local.get([key, "pending_sync"]);
  const dayStats = data[key] || {};
  const pendingSync = data.pending_sync || {};

  dayStats[currentDomain] = (dayStats[currentDomain] || 0) + elapsedSec;

  const queueKey = `${currentDomain}|${date}|${hour}`;
  pendingSync[queueKey] = (pendingSync[queueKey] || 0) + elapsedSec;

  await browser.storage.local.set({
    [key]: dayStats,
    pending_sync: pendingSync
  });

  console.log(`[Tyme] Logged ${elapsedSec}s to ${currentDomain} (Hour ${hour})`);
}

async function syncToServer() {
  const data = await browser.storage.local.get("pending_sync");
  const pending = data.pending_sync || {};
  const entries = Object.entries(pending);

  if (entries.length === 0) return;

  const payloadLogs = entries.map(([key, sec]) => {
    const [domain, date, hourStr] = key.split("|");
    return {
      domain: domain,
      date: date,
      hour: parseInt(hourStr, 10),
      duration_sec: sec
    };
  });

  try {
    const response = await fetch("http://localhost:8080/api/v1/wellbeing/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: payloadLogs })
    });

    if (response.ok) {
      console.log(`[Tyme] Successfully synced ${payloadLogs.length} hourly entries to meapi server!`);
      await browser.storage.local.remove("pending_sync");
    } else {
      console.warn(`[Tyme] Server responded with status ${response.status}. Retrying later.`);
    }
  } catch (err) {
    console.log("[Tyme] Server unreachable, keeping data in local queue.");
  }
}

async function handleStateChange() {
  await flushTime();

  if (isIdle) {
    currentDomain = null;
    sessionStartTime = null;
    broadcastState();
    return;
  }

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

function broadcastState() {
  browser.runtime.sendMessage({
    type: "STATE_CHANGED",
    activeDomain: currentDomain,
    isTracking: !!currentDomain
  }).catch(() => {

  });
}

browser.tabs.onActivated.addListener(() => handleStateChange());

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    handleStateChange();
  }
});

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

browser.idle.onStateChanged.addListener((state) => {
  isIdle = state !== "active";
  handleStateChange();
});

setInterval(() => {
  if (currentDomain) {
    flushTime();
  }
}, 15000);

setInterval(() => {
  syncToServer();
}, 30000);

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

handleStateChange();
syncToServer();
