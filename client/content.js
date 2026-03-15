const isTopFrame = window === window.top;
let lastAnalyzedUrl = null;
let isMonitoringStopped = false;
let realtimeEnabled = true;

async function loadRealtimeSetting() {
  try {
    const settings = await chrome.storage.local.get({ realtimeEnabled: true });
    realtimeEnabled = Boolean(settings.realtimeEnabled);
  } catch (_) {
    realtimeEnabled = true;
  }
}

function sendAnalysisRequest(force = false) {
  if (!isTopFrame || isMonitoringStopped || !realtimeEnabled) {
    return;
  }

  const currentUrl = location.href;
  if (!force && currentUrl === lastAnalyzedUrl) {
    return;
  }

  lastAnalyzedUrl = currentUrl;

  chrome.runtime.sendMessage({
    type: "ANALYZE_DOM",
    url: currentUrl
  }).catch(() => {
    console.debug("Content script: Background not ready, message not sent.");
  });
}

function scheduleUrlCheck() {
  setTimeout(() => sendAnalysisRequest(false), 120);
}

function setupSpaNavigationHooks() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    window.dispatchEvent(new Event("trustscreen:url-change"));
    return result;
  };

  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    window.dispatchEvent(new Event("trustscreen:url-change"));
    return result;
  };
}

if (isTopFrame) {
  setupSpaNavigationHooks();

  loadRealtimeSetting().then(() => {
    if (realtimeEnabled) {
      sendAnalysisRequest(true);
    }
  });

  window.addEventListener("load", scheduleUrlCheck);
  window.addEventListener("pageshow", scheduleUrlCheck);
  window.addEventListener("popstate", scheduleUrlCheck);
  window.addEventListener("hashchange", scheduleUrlCheck);
  window.addEventListener("trustscreen:url-change", scheduleUrlCheck);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STOP_MONITORING") {
    isMonitoringStopped = true;
  } else if (message.type === "START_MONITORING") {
    isMonitoringStopped = false;
    sendAnalysisRequest(true);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.realtimeEnabled) {
    return;
  }

  realtimeEnabled = Boolean(changes.realtimeEnabled.newValue);
  if (realtimeEnabled && isTopFrame && !isMonitoringStopped) {
    sendAnalysisRequest(true);
  }
});
