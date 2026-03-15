const port = chrome.runtime.connect({ name: "popup" });

const DEFAULT_SETTINGS = {
  theme: "light",
  realtimeEnabled: true
};

document.addEventListener("DOMContentLoaded", async () => {
  const checkButton = document.getElementById("check");
  const statusDiv = document.getElementById("status");
  const resultContainer = document.getElementById("result-container");
  const resultContentDiv = document.getElementById("result-content");
  const verdictIconSpan = document.getElementById("verdict-icon");
  const verdictTextSpan = document.getElementById("verdict-text");
  const urlInput = document.getElementById("url-input");

  const settingsToggle = document.getElementById("settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const themeToggle = document.getElementById("theme-toggle");
  const realtimeToggle = document.getElementById("realtime-toggle");

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  applyTheme(settings.theme);
  themeToggle.checked = settings.theme === "dark";
  realtimeToggle.checked = Boolean(settings.realtimeEnabled);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      urlInput.value = tab.url;
    }
  } catch (error) {
    console.error("Cannot read active tab URL:", error);
  }

  settingsToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  settingsPanel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    settingsPanel.hidden = true;
  });

  themeToggle.addEventListener("change", async () => {
    const nextTheme = themeToggle.checked ? "dark" : "light";
    await chrome.storage.local.set({ theme: nextTheme });
    applyTheme(nextTheme);
  });

  realtimeToggle.addEventListener("change", async () => {
    const enabled = realtimeToggle.checked;
    await chrome.storage.local.set({ realtimeEnabled: enabled });
    statusDiv.textContent = enabled
      ? "[ realtime:on ] проверка в реальном времени включена."
      : "[ realtime:off ] проверка в реальном времени отключена.";
  });

  checkButton.onclick = async () => {
    const normalizedUrl = normalizeUrl(urlInput.value);
    if (!normalizedUrl) {
      statusDiv.textContent = "[ input:error ] введите корректный url.";
      resultContainer.style.display = "none";
      return;
    }

    urlInput.value = normalizedUrl;
    statusDiv.textContent = "[ scan:run ] выполняется ручная проверка...";
    resultContainer.style.display = "none";

    chrome.runtime.sendMessage({
      type: "MANUAL_CHECK",
      url: normalizedUrl
    });
  };

  port.onMessage.addListener((message) => {
    if (message.type === "ANALYSIS_RESULT") {
      statusDiv.textContent = "[ scan:done ] результат получен.";
      displayAnalysisResult(message.result);
    } else if (message.type === "ERROR") {
      statusDiv.textContent = "[ scan:fail ] ошибка во время проверки.";
      resultContainer.style.display = "none";
    }
  });

  function applyTheme(theme) {
    document.body.classList.toggle("dark-theme", theme === "dark");
  }

  function normalizeUrl(input) {
    const raw = (input || "").trim();
    if (!raw) {
      return null;
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    try {
      const parsed = new URL(withProtocol);
      return parsed.href;
    } catch {
      return null;
    }
  }

  function displayAnalysisResult(result) {
    resultContentDiv.innerHTML = "";

    let icon = "..";
    let iconClass = "verdict-info";

    switch (result.verdict) {
      case "safe":
        icon = "OK";
        iconClass = "verdict-safe";
        break;
      case "phishing":
        icon = "!!";
        iconClass = "verdict-phishing";
        break;
      case "suspicious":
        icon = "??";
        iconClass = "verdict-suspicious";
        break;
    }

    verdictIconSpan.textContent = icon;
    verdictIconSpan.className = `verdict-icon ${iconClass}`;
    verdictTextSpan.textContent = `Результат: ${String(result.verdict || "unknown").toUpperCase()}`;

    const urlRow = document.createElement("div");
    urlRow.className = "result-row";
    urlRow.innerHTML = `
        <span class="result-label">URL:</span>
        <span class="result-value">${escapeHtml(urlInput.value)}</span>
    `;
    resultContentDiv.appendChild(urlRow);

    const verdictRow = document.createElement("div");
    verdictRow.className = "result-row";
    verdictRow.innerHTML = `
        <span class="result-label">Вердикт:</span>
        <span class="result-value verdict-${result.verdict}">${escapeHtml(result.verdict || "unknown")}</span>
    `;
    resultContentDiv.appendChild(verdictRow);

    const scoreRow = document.createElement("div");
    scoreRow.className = "result-row";
    scoreRow.innerHTML = `
        <span class="result-label">Оценка:</span>
        <span class="result-value">${(Number(result.score || 0) * 100).toFixed(2)}%</span>
    `;
    resultContentDiv.appendChild(scoreRow);

    const scoreBarContainer = document.createElement("div");
    scoreBarContainer.className = "score-bar-container";
    const scoreBar = document.createElement("div");
    scoreBar.className = `score-bar score-bar-${result.verdict}`;
    const scorePercentage = Math.min(100, Math.max(0, Number(result.score || 0) * 100));
    scoreBar.style.width = `${scorePercentage}%`;
    scoreBarContainer.appendChild(scoreBar);
    resultContentDiv.appendChild(scoreBarContainer);

    const reasonsRow = document.createElement("div");
    reasonsRow.className = "result-row";
    const reasons = Array.isArray(result.reasons) ? result.reasons : [];
    reasonsRow.innerHTML = `
        <span class="result-label">Причины:</span>
        <span class="result-value"><ul class="reasons-list">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></span>
    `;
    resultContentDiv.appendChild(reasonsRow);

    resultContainer.style.display = "block";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
});
