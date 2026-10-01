const SERVICE_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  alice: "https://alice.yandex.ru/"
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FOXWEB_OPEN") return false;

  openSelectedService(message.prompt)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function openSelectedService(prompt) {
  const { service = "chatgpt" } = await chrome.storage.local.get("service");
  const url = SERVICE_URLS[service];
  if (!url) throw new Error("Выберите поддерживаемый веб-чат в настройках.");

  if (service === "alice") {
    return insertIntoAlice(String(prompt || ""));
  }

  await chrome.tabs.create({ url });
  return { inserted: false };
}

async function insertIntoAlice(prompt) {
  if (!prompt) throw new Error("Подготовленный запрос оказался пустым.");

  const tabs = await chrome.tabs.query({ url: "https://alice.yandex.ru/*" });
  let tab = tabs.find((item) => item.active) || tabs[0];
  if (!tab?.id) {
    await chrome.storage.local.set({ pendingAlicePrompt: prompt });
    tab = await chrome.tabs.create({ url: SERVICE_URLS.alice });
    return { inserted: false, opened: true };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FOXWEB_INSERT_ALICE", prompt });
    if (response?.ok) return { inserted: true };
  } catch {
    // The tab may have been open before the extension was installed or updated.
  }

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["alice.js"] });
  const response = await chrome.tabs.sendMessage(tab.id, { type: "FOXWEB_INSERT_ALICE", prompt });
  if (!response?.ok) throw new Error(response?.error || "Поле ввода Алисы пока не найдено.");
  return { inserted: true };
}
