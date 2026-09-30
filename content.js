(() => {
  const PANEL_ID = "foxweb-helper";
  const CANDIDATES = [
    '[data-testid*="question"]', '[data-testid*="task"]', '[data-testid*="poll"]',
    '[class*="Question"]', '[class*="question"]', '[class*="Task"]',
    '[class*="task"]', '[class*="Poll"]', '[class*="poll"]'
  ];
  const BLOCKED = ['[data-testid="events-list"]', '[data-testid*="chat"]', '[class*="chat"]', `#${PANEL_ID}`];
  let question = "";
  let lastPrompt = "";
  let hidden = false;
  let timer;

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 80 && rect.height > 30 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  }

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }

  function extract(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(`script, style, noscript, svg, #${PANEL_ID}`).forEach((node) => node.remove());
    const lines = [clean(clone.innerText || clone.textContent)].filter(Boolean);
    root.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input, index) => {
      const label = input.closest("label") || (input.id ? root.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);
      const text = clean(label?.innerText || input.getAttribute("aria-label"));
      if (text && !lines.some((line) => line.includes(text))) lines.push(`${index + 1}. ${text}`);
    });
    return clean(lines.join("\n")).slice(0, 8000);
  }

  function score(element) {
    if (!visible(element) || BLOCKED.some((selector) => element.closest(selector))) return -1;
    const text = extract(element);
    if (text.length < 8 || text.length > 12000) return -1;
    const controls = element.querySelectorAll('input[type="radio"], input[type="checkbox"], textarea, select, button').length;
    let value = Math.min(text.length, 900) / 20 + Math.min(controls, 8) * 15;
    if (/xp|задач|вопрос|ответ|выберите|решите|найдите|укажите|сколько|чему/i.test(text)) value += 30;
    if (element.matches('[data-testid*="question"], [data-testid*="task"], [data-testid*="poll"]')) value += 35;
    if (element.getBoundingClientRect().height > innerHeight * .9) value -= 50;
    return value;
  }

  function findQuestion() {
    let best = null;
    let bestScore = 74;
    for (const element of document.querySelectorAll(CANDIDATES.join(","))) {
      const value = score(element);
      if (value > bestScore) { best = element; bestScore = value; }
    }
    return best ? extract(best) : "";
  }

  function promptFor(mode) {
    const request = mode === "hint"
      ? "Дай 2–4 наводящие подсказки. Не называй готовый ответ, номер или букву правильного варианта и не доводи вычисление до финального результата."
      : "Реши задание пошагово и понятно. В конце отдельной строкой напиши итоговый ответ.";
    return `Помоги школьнику с заданием Фоксфорда. Отвечай по-русски. ${request}\n\nЗадание:\n${question}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;left:-9999px;top:-9999px";
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    }
  }

  function makePanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "Помощник по XP без API");
    panel.innerHTML = `
      <div class="foxweb-head">
        <div class="foxweb-logo" aria-hidden="true">✦</div>
        <div><div class="foxweb-title">XP без API-ключа</div><div class="foxweb-status">Задание найдено</div></div>
        <button class="foxweb-close" type="button" aria-label="Скрыть">×</button>
      </div>
      <div class="foxweb-body">
        <p class="foxweb-preview"></p>
        <div class="foxweb-actions">
          <button class="foxweb-button" data-mode="hint" type="button">💡 Подсказка</button>
          <button class="foxweb-button foxweb-button--answer" data-mode="answer" type="button">✓ Показать ответ</button>
        </div>
        <div class="foxweb-message" role="status" aria-live="polite"></div>
        <button class="foxweb-copy" type="button">Скопировать запрос ещё раз</button>
      </div>`;
    panel.querySelector(".foxweb-close").addEventListener("click", () => { hidden = true; panel.remove(); });
    panel.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => launch(button.dataset.mode)));
    panel.querySelector(".foxweb-copy").addEventListener("click", async () => {
      const ok = await copyText(lastPrompt);
      showMessage(ok ? "Запрос снова скопирован." : "Не удалось скопировать. Разрешите браузеру доступ к буферу обмена.", !ok);
    });
    document.documentElement.append(panel);
    return panel;
  }

  function showMessage(text, error = false) {
    const box = document.querySelector(`#${PANEL_ID} .foxweb-message`);
    if (!box) return;
    box.dataset.visible = "true";
    box.dataset.error = String(error);
    box.textContent = text;
  }

  async function launch(mode) {
    lastPrompt = promptFor(mode);
    const copied = await copyText(lastPrompt);
    if (!copied) {
      showMessage("Не удалось скопировать запрос. Разрешите браузеру доступ к буферу обмена.", true);
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "FOXWEB_OPEN" });
    if (!response?.ok) {
      showMessage(response?.error || "Не удалось открыть веб-чат.", true);
      return;
    }
    showMessage("Веб-чат открыт, запрос скопирован. Вставьте его в поле сообщения и отправьте.");
    document.querySelector(`#${PANEL_ID} .foxweb-copy`).dataset.visible = "true";
  }

  function update() {
    const found = findQuestion();
    if (found !== question) hidden = false;
    question = found;
    let panel = document.getElementById(PANEL_ID);
    if (!panel && !hidden && question) panel = makePanel();
    if (!panel) return;
    panel.querySelector(".foxweb-preview").textContent = question.replace(/\n/g, " · ").slice(0, 140);
    panel.querySelectorAll("[data-mode]").forEach((button) => { button.disabled = !question; });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(update, 300); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  window.addEventListener("resize", schedule, { passive: true });
  update();
})();
