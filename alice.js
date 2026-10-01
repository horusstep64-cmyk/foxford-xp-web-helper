(() => {
  if (window.__FOXWEB_ALICE_LOADED) return;
  window.__FOXWEB_ALICE_LOADED = true;

  const SELECTORS = [
    'textarea[placeholder="Спросите о чём угодно"]',
    "textarea.AliceInput-Textarea",
    "textarea",
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ];

  function findInput() {
    return SELECTORS.map((selector) => document.querySelector(selector)).find((element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 100 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
    });
  }

  async function waitForInput() {
    const existing = findInput();
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Поле ввода Алисы не найдено."));
      }, 10000);
      const observer = new MutationObserver(() => {
        const input = findInput();
        if (!input) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(input);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function insertPrompt(prompt) {
    const input = await waitForInput();
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(input, prompt);
      else input.value = prompt;
    } else {
      input.textContent = prompt;
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "FOXWEB_INSERT_ALICE") return false;
    insertPrompt(String(message.prompt || ""))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  chrome.storage.local.get("pendingAlicePrompt").then(async ({ pendingAlicePrompt }) => {
    if (!pendingAlicePrompt) return;
    await insertPrompt(pendingAlicePrompt);
    await chrome.storage.local.remove("pendingAlicePrompt");
  }).catch(() => {});
})();
