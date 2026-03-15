const params = new URLSearchParams(location.search);
const rawUrl = params.get("url") || "";
const urlElement = document.getElementById("url");
const proceedButton = document.getElementById("proceed-btn");

urlElement.innerText = rawUrl || "не указан";

const reasons = [
  "Этот сайт был определён как фишинговый.",
  "Доступ к нему заблокирован для защиты ваших данных."
];

const reasonsListElement = document.getElementById("reasons-list");
reasons.forEach(r => {
  const li = document.createElement("li");
  li.textContent = r;
  reasonsListElement.appendChild(li);
});

let safeTarget = null;
try {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    safeTarget = parsed.href;
  }
} catch (_) {
  safeTarget = null;
}

if (safeTarget) {
  proceedButton.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "ADD_TEMP_BYPASS",
        url: safeTarget
      });
    } catch (_) {
    }
    window.location.assign(safeTarget);
  });
} else {
  proceedButton.disabled = true;
  proceedButton.textContent = "Некорректный URL";
}
