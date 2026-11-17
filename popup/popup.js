let stats = {};
let activeDomain = null;
let isTracking = false;

function formatTime(sec) {
  if (!sec || sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function render() {
  const totalSec = Object.values(stats).reduce((sum, n) => sum + n, 0);
  const totalEl = document.getElementById("total-time");
  if (totalEl) {
    totalEl.textContent = formatTime(totalSec);
  }

  const dot = document.getElementById("status-dot");
  const status = document.getElementById("status-text");

  if (dot && status) {
    if (isTracking && activeDomain) {
      dot.classList.add("active");
      status.textContent = activeDomain;
    } else {
      dot.classList.remove("active");
      status.textContent = "Paused";
    }
  }

  const list = document.getElementById("domain-list");
  if (!list) return;

  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    list.innerHTML = `<li class="empty">No activity today</li>`;
    return;
  }

  list.innerHTML = entries
    .map(([domain, time]) => {
      const pct = totalSec > 0 ? Math.round((time / totalSec) * 100) : 0;
      return `
        <li class="site-row">
          <div class="site-info">
            <span class="site-domain" title="${domain}">${domain}</span>
            <span class="site-time">${formatTime(time)}</span>
          </div>
          <div class="bar-bg">
            <div class="bar-fill" style="width: ${pct}%"></div>
          </div>
        </li>
      `;
    })
    .join("");
}

async function init() {
  try {
    const res = await browser.runtime.sendMessage({ type: "GET_STATS" });
    if (res) {
      stats = res.stats || {};
      activeDomain = res.activeDomain;
      isTracking = res.isTracking;
      render();
    }
  } catch (e) {
    console.error("Failed to load stats from tracker:", e);
  }
}

// Listen for tab/window changes in real time
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_CHANGED") {
    activeDomain = message.activeDomain;
    isTracking = message.isTracking;
    render();
  }
});

// Live tick every second
setInterval(() => {
  if (isTracking && activeDomain) {
    stats[activeDomain] = (stats[activeDomain] || 0) + 1;
    render();
  }
}, 1000);

document.addEventListener("DOMContentLoaded", init);
