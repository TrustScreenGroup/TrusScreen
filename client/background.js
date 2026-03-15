importScripts("trustedStorage.js");

const API = "http://127.0.0.1:8000/analyze";
const TRUSTED_LIST_API = "http://127.0.0.1:8000/api/trusted-list";
const TRUSTED_SYNC_META_KEY = "trusted_sync_ts";
const TRUSTED_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TRUSTED_SYNC_ALARM = "trustscreen-daily-sync";
const TRUSTED_SYNC_PERIOD_MIN = 24 * 60;
let popupPort = null;
const TEMP_BYPASS_TTL_MS = 10 * 60 * 1000;
const tempBypassByHost = new Map();

chrome.runtime.onConnect.addListener(port => {
  if (port.name === "popup") {
    chrome.storage.session.get(['lastResult']).then(result => {
      if (result.lastResult) {
        port.postMessage({ type: "ANALYSIS_RESULT", result: result.lastResult });
      }
    });
    popupPort = port;
    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  }
});

syncTrustedList(false).catch(error => {
  console.warn("Initial trusted list sync failed:", error);
});
scheduleDailySync();

chrome.runtime.onInstalled.addListener(() => {
  scheduleDailySync();
  syncTrustedList(true).catch(error => {
    console.warn("Trusted list sync on install failed:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleDailySync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === TRUSTED_SYNC_ALARM) {
    syncTrustedList(true).catch(error => {
      console.warn("Trusted list daily sync failed:", error);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "ANALYZE_DOM") {
    handleDomAnalysis(message, sender);
  } else if (message.type === "MANUAL_CHECK") {
    handleManualCheck(message, sender);
  } else if (message.type === "ADD_TEMP_BYPASS") {
    addTemporaryBypass(message.url);
  }
});

function extractHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function addTemporaryBypass(url) {
  const host = extractHost(url);
  if (!host) {
    return;
  }

  tempBypassByHost.set(host, Date.now() + TEMP_BYPASS_TTL_MS);
}

function isBypassed(url) {
  const host = extractHost(url);
  if (!host) {
    return false;
  }

  const expiresAt = tempBypassByHost.get(host);
  if (!expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    tempBypassByHost.delete(host);
    return false;
  }

  return true;
}

function scheduleDailySync() {
  chrome.alarms.create(TRUSTED_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: TRUSTED_SYNC_PERIOD_MIN
  });
}

async function isRealtimeEnabled() {
  try {
    const settings = await chrome.storage.local.get({ realtimeEnabled: true });
    return Boolean(settings.realtimeEnabled);
  } catch (_) {
    return true;
  }
}

async function syncTrustedList(force = false) {
  try {
    const lastSyncTs = await trustedStorage.getMeta(TRUSTED_SYNC_META_KEY);
    const now = Date.now();

    if (!force && lastSyncTs && now - Number(lastSyncTs) < TRUSTED_SYNC_INTERVAL_MS) {
      return;
    }

    const res = await fetch(TRUSTED_LIST_API);
    if (!res.ok) {
      throw new Error(`Trusted list HTTP status: ${res.status}`);
    }

    const data = await res.json();
    await trustedStorage.replacePhishingDomains(data?.phishing || []);
    await trustedStorage.setMeta(TRUSTED_SYNC_META_KEY, now);
  } catch (error) {
    console.debug("Trusted list sync skipped:", error?.message || error);
  }
}

async function buildOfflineResult(url) {
  const isKnownPhishing = await trustedStorage.isPhishingDomain(url);

  if (isKnownPhishing) {
    return {
      verdict: "phishing",
      score: 1.0,
      reasons: [
        "Сервер недоступен",
        "Домен найден в локальной базе известных фишинговых сайтов"
      ]
    };
  }

  return {
    verdict: "suspicious",
    score: 0.5,
    reasons: [
      "Сервер недоступен",
      "В локальной базе нет подтверждения, что сайт безопасен"
    ]
  };
}

async function handleDomAnalysis(message, sender) {
  const { url } = message;
  const tabId = sender?.tab?.id;

  try {
    const realtimeEnabled = await isRealtimeEnabled();
    if (!realtimeEnabled) {
      return;
    }

    await syncTrustedList(false);

    const params = new URLSearchParams({ url: url });
    const fullUrl = `${API}?${params.toString()}`;
    console.log(`Sending ANALYZE_DOM request to: ${fullUrl}`);

    const res = await fetch(fullUrl);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();

    await chrome.storage.session.set({ lastResult: data });
    if (data.verdict === "phishing") {
      await trustedStorage.addPhishingDomain(url);
    }

    if (popupPort) {
      popupPort.postMessage({ type: "ANALYSIS_RESULT", result: data });
    }

    if (data.verdict === "phishing" && Number.isInteger(tabId) && !isBypassed(url)) {
      chrome.tabs.sendMessage(tabId, { type: "STOP_MONITORING" });
      await chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL("warning.html") + "?url=" + encodeURIComponent(url)
      });
    }

  } catch (error) {
    console.error("Background script: Fetch error during analysis:", error);
    const fallbackData = await buildOfflineResult(url);
    await chrome.storage.session.set({ lastResult: fallbackData });

    if (popupPort) {
      popupPort.postMessage({ type: "ANALYSIS_RESULT", result: fallbackData });
    }

    if (fallbackData.verdict === "phishing" && Number.isInteger(tabId) && !isBypassed(url)) {
      chrome.tabs.sendMessage(tabId, { type: "STOP_MONITORING" });
      await chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL("warning.html") + "?url=" + encodeURIComponent(url)
      });
    }

  }
}

async function handleManualCheck(message, sender) {
  const { url } = message;

  try {
    await syncTrustedList(false);

    const params = new URLSearchParams({ url: url });
    const fullUrl = `${API}?${params.toString()}`;
    console.log(`Sending MANUAL_CHECK request to: ${fullUrl}`);

    const res = await fetch(fullUrl);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    await chrome.storage.session.set({ lastResult: data });
    if (data.verdict === "phishing") {
      await trustedStorage.addPhishingDomain(url);
    }

    if (popupPort) {
      popupPort.postMessage({ type: "ANALYSIS_RESULT", result: data });
    }

  } catch (error) {
    console.error("Background script: Fetch error during manual check:", error);
    const fallbackData = await buildOfflineResult(url);
    await chrome.storage.session.set({ lastResult: fallbackData });

    if (popupPort) {
      popupPort.postMessage({ type: "ANALYSIS_RESULT", result: fallbackData });
      popupPort.postMessage({ type: "ERROR", error: `Offline fallback: ${error.message}` });
    }

    if (fallbackData.verdict === "phishing") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && !isBypassed(url)) {
        chrome.tabs.sendMessage(tab.id, { type: "STOP_MONITORING" });
        await chrome.tabs.update(tab.id, {
          url: chrome.runtime.getURL("warning.html") + "?url=" + encodeURIComponent(url)
        });
      }
    }

  }
}
