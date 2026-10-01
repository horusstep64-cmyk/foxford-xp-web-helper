const SERVICE_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  alice: "https://alice.yandex.ru/"
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FOXWEB_CAPTURE_TASK") {
    captureTask(sender, message.capture)
      .then((imageDataUrl) => sendResponse({ ok: true, imageDataUrl }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type !== "FOXWEB_OPEN") return false;

  openSelectedService(message.prompt, message.imageDataUrl)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function openSelectedService(prompt, imageDataUrl) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt.includes("ОПИСАНИЕ ЗАДАЧИ")) {
    throw new Error("Описание задачи не попало в запрос. Обновите страницу Фоксфорда и попробуйте ещё раз.");
  }
  const { service = "alice" } = await chrome.storage.local.get("service");
  const url = SERVICE_URLS[service];
  if (!url) throw new Error("Выберите поддерживаемый веб-чат в настройках.");

  if (service === "alice") {
    return insertIntoAlice(cleanPrompt, imageDataUrl);
  }

  await chrome.tabs.create({ url });
  return { inserted: false };
}

async function insertIntoAlice(prompt, imageDataUrl) {
  if (!prompt) throw new Error("Подготовленный запрос оказался пустым.");
  if (!String(imageDataUrl || "").startsWith("data:image/png;base64,")) {
    throw new Error("Снимок задачи не создан. Убедитесь, что условие видно на странице.");
  }

  const tabs = await chrome.tabs.query({ url: "https://alice.yandex.ru/*" });
  let tab = tabs.find((item) => item.active) || tabs[0];
  if (!tab?.id) {
    await chrome.storage.local.set({ pendingAliceRequest: { prompt, imageDataUrl } });
    tab = await chrome.tabs.create({ url: SERVICE_URLS.alice });
    return { inserted: false, opened: true };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FOXWEB_INSERT_ALICE", prompt, imageDataUrl });
    if (response?.ok) return { inserted: true };
  } catch {
    // The tab may have been open before the extension was installed or updated.
  }

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["alice.js"] });
  const response = await chrome.tabs.sendMessage(tab.id, { type: "FOXWEB_INSERT_ALICE", prompt, imageDataUrl });
  if (!response?.ok) throw new Error(response?.error || "Поле ввода Алисы пока не найдено.");
  return { inserted: true };
}

async function captureTask(sender, capture) {
  const tab = sender.tab;
  if (!tab?.active || !Number.isInteger(tab.windowId) || !/^https:\/\/(?:www\.)?foxford\.ru\//.test(tab.url || "")) {
    throw new Error("Снимок можно сделать только из активной вкладки Фоксфорда.");
  }
  const rect = capture?.rect;
  const viewport = capture?.viewport;
  if (!rect || !viewport || rect.width < 40 || rect.height < 30 || viewport.width < 100 || viewport.height < 100) {
    throw new Error("Не удалось определить область задачи для снимка.");
  }

  const pageImage = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const blob = await (await fetch(pageImage)).blob();
  const bitmap = await createImageBitmap(blob);
  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;
  const left = Math.max(0, Math.round(rect.left * scaleX));
  const top = Math.max(0, Math.round(rect.top * scaleY));
  const right = Math.min(bitmap.width, Math.round((rect.left + rect.width) * scaleX));
  const bottom = Math.min(bitmap.height, Math.round((rect.top + rect.height) * scaleY));
  const width = right - left;
  const height = bottom - top;
  if (width < 40 || height < 30) throw new Error("Область задачи не видна на экране.");

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
  bitmap.close();
  const cropped = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(cropped);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
