const SERVICE_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  alice: "https://alice.yandex.ru/"
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FOXWEB_OPEN") return false;

  openSelectedService()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function openSelectedService() {
  const { service = "chatgpt" } = await chrome.storage.local.get("service");
  const url = SERVICE_URLS[service];
  if (!url) throw new Error("Выберите поддерживаемый веб-чат в настройках.");
  await chrome.tabs.create({ url });
}
