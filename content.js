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
    const homework = extractHomework();
    if (homework) return homework;

    let best = null;
    let bestScore = 74;
    for (const element of document.querySelectorAll(CANDIDATES.join(","))) {
      const value = score(element);
      if (value > bestScore) { best = element; bestScore = value; }
    }
    return best ? extract(best) : "";
  }

  function findCaptureTarget() {
    if (/^\/lessons\/[^/]+\/tasks\/[^/]+/.test(location.pathname)) {
      return document.querySelector([
        "#taskContentInTaskView",
        '[data-testid="task-content"]',
        '[data-testid*="taskContent"]',
        '[class*="InteractiveContent"]'
      ].join(","));
    }

    let best = null;
    let bestScore = 74;
    for (const element of document.querySelectorAll(CANDIDATES.join(","))) {
      const value = score(element);
      if (value > bestScore) { best = element; bestScore = value; }
    }
    return best;
  }

  function extractHomework() {
    if (!/^\/lessons\/[^/]+\/tasks\/[^/]+/.test(location.pathname)) return "";
    const content = document.querySelector([
      "#taskContentInTaskView",
      '[data-testid="task-content"]',
      '[data-testid*="taskContent"]',
      '[class*="InteractiveContent"]'
    ].join(","));
    if (!content || !visible(content)) return "";

    const imageDescriptions = [...content.querySelectorAll("img[alt]")]
      .map((image) => clean(image.alt))
      .filter((text) => text && !/^image|изображение$/i.test(text));
    const condition = clean([content.innerText || content.textContent, ...imageDescriptions].filter(Boolean).join("\n"));
    if (condition.length < 8) return "";
    const form = document.querySelector("#taskForm") || content.parentElement?.querySelector("form");
    const details = extractAnswerDetails(form);
    return clean([`Условие:\n${condition}`, details.options, details.mode].filter(Boolean).join("\n\n")).slice(0, 8000);
  }

  function extractAnswerDetails(form) {
    if (!form) return { options: "", mode: "Формат ответа: свободный ответ." };
    const radios = [...form.querySelectorAll('input[type="radio"], [role="radio"]')];
    const checks = [...form.querySelectorAll('input[type="checkbox"], [role="checkbox"]')];
    const selects = [...form.querySelectorAll("select")];
    const textInputs = [...form.querySelectorAll('input[type="text"], input:not([type]), textarea')];
    const multiSelect = selects.some((select) => select.multiple || select.getAttribute("aria-multiselectable") === "true");

    let mode = "Формат ответа: свободный ответ.";
    if (checks.length || multiSelect) mode = "Формат ответа: можно выбрать несколько вариантов.";
    else if (radios.length || selects.length) mode = "Формат ответа: можно выбрать только один вариант.";
    else if (!textInputs.length) mode = "Формат ответа на странице не удалось определить.";

    const optionTexts = [];
    const add = (value) => {
      const text = clean(value);
      if (text && !optionTexts.includes(text)) optionTexts.push(text);
    };
    [...radios, ...checks].forEach((control) => {
      const label = control.closest("label") || (control.id ? form.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null);
      add(label?.innerText || control.getAttribute("aria-label") || control.textContent);
    });
    selects.forEach((select) => [...select.options].filter((option) => !option.disabled && option.value).forEach((option) => add(option.textContent)));
    form.querySelectorAll('[role="option"], [data-testid*="answer"], [class*="answerOption" i]').forEach((option) => add(option.innerText || option.textContent));

    return {
      options: optionTexts.length ? `Варианты ответа:\n${optionTexts.map((text, index) => `${index + 1}. ${text}`).join("\n")}` : "",
      mode
    };
  }

  function promptFor(mode, taskText) {
    const request = mode === "hint"
      ? "Дай 2–4 наводящие подсказки. Не называй готовый ответ, номер или букву правильного варианта и не доводи вычисление до финального результата."
      : "Реши задание пошагово и понятно. В конце отдельной строкой напиши итоговый ответ.";
    return [
      "Помоги школьнику с заданием Фоксфорда. Отвечай по-русски.",
      request,
      "Если перечислены варианты ответа, обязательно учитывай их и правило о том, можно выбрать один вариант или несколько.",
      "",
      "К сообщению прикреплён снимок только области задачи. Обязательно прочитай формулы, рисунки и обозначения на изображении.",
      "",
      "===== ОПИСАНИЕ ЗАДАЧИ =====",
      taskText,
      "===== КОНЕЦ ОПИСАНИЯ ====="
    ].join("\n");
  }

  async function captureTaskImage() {
    const target = findCaptureTarget();
    if (!target || !visible(target)) throw new Error("Не удалось найти видимую область задачи для снимка.");
    const panel = document.getElementById(PANEL_ID);
    const previousVisibility = panel?.style.visibility || "";
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (panel) panel.style.visibility = "hidden";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const rect = target.getBoundingClientRect();
      const visibleRect = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        width: Math.min(innerWidth, rect.right) - Math.max(0, rect.left),
        height: Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)
      };
      const response = await chrome.runtime.sendMessage({
        type: "FOXWEB_CAPTURE_TASK",
        capture: {
          rect: visibleRect,
          viewport: { width: innerWidth, height: innerHeight }
        }
      });
      if (!response?.ok) throw new Error(response?.error || "Не удалось сделать снимок задачи.");
      return response.imageDataUrl;
    } finally {
      if (panel) panel.style.visibility = previousVisibility;
    }
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
    panel.setAttribute("aria-label", "Помощник по заданиям без API");
    panel.innerHTML = `
      <div class="foxweb-head">
        <div class="foxweb-logo" aria-hidden="true">✦</div>
        <div><div class="foxweb-title">Задания без API-ключа</div><div class="foxweb-status">Задание найдено</div></div>
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
    const freshQuestion = findQuestion();
    if (freshQuestion.length < 8) {
      showMessage("Не удалось прочитать условие задачи. Откройте саму задачу и попробуйте ещё раз.", true);
      return;
    }
    question = freshQuestion;
    lastPrompt = promptFor(mode, freshQuestion);
    let imageDataUrl;
    try {
      showMessage("Делаю снимок области задачи…");
      imageDataUrl = await captureTaskImage();
    } catch (error) {
      showMessage(String(error?.message || error), true);
      return;
    }
    const copied = await copyText(lastPrompt);
    if (!copied) {
      showMessage("Не удалось скопировать запрос. Разрешите браузеру доступ к буферу обмена.", true);
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "FOXWEB_OPEN", prompt: lastPrompt, imageDataUrl });
    if (!response?.ok) {
      showMessage(response?.error || "Не удалось открыть веб-чат.", true);
      return;
    }
    if (response.inserted) {
      showMessage("Снимок задачи и описание вставлены в Алису. Проверьте их и нажмите отправку.");
    } else if (response.opened) {
      showMessage("Алиса открыта. Запрос вставится после загрузки страницы; проверьте его и нажмите отправку.");
    } else {
      showMessage("Веб-чат открыт, запрос скопирован. Вставьте его в поле сообщения и отправьте.");
    }
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
