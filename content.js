(() => {
  const PANEL_ID = "foxweb-helper";
  const CANDIDATES = [
    '[role="dialog"]', '[aria-modal="true"]',
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
    const media = element.querySelectorAll('img, canvas, video').length;
    const answerControls = element.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="option"], textarea, select').length;
    const buttons = element.querySelectorAll("button").length;
    const hasTaskWords = /xp|задач|вопрос|ответ|выберите|решите|найдите|укажите|сколько|чему/i.test(text);
    if ((!hasTaskWords && !media && !answerControls) || text.length > 20000) return -1;
    let value = Math.min(text.length, 900) / 20 + Math.min(answerControls, 8) * 18 + Math.min(buttons, 4) * 3;
    value += Math.min(media, 4) * 12;
    if (hasTaskWords) value += 30;
    if (element.matches('[data-testid*="question"], [data-testid*="task"], [data-testid*="poll"]')) value += 35;
    if (element.matches('[role="dialog"], [aria-modal="true"]')) value += 45;
    if (element.getBoundingClientRect().height > innerHeight * .9) value -= 50;
    return value;
  }

  function findQuestion() {
    const homework = extractHomework();
    if (homework) return homework;
    return extractXpTask();
  }

  function findCaptureTarget() {
    if (/^\/lessons\/[^/]+\/tasks\/[^/]+/.test(location.pathname)) {
      const content = document.querySelector([
        "#taskContentInTaskView",
        '[data-testid="task-content"]',
        '[data-testid*="taskContent"]',
        '[class*="InteractiveContent"]'
      ].join(","));
      const form = document.querySelector("#taskForm") || content?.parentElement?.querySelector("form");
      return commonAncestor(content, form) || content;
    }

    return findXpTarget();
  }

  function findXpTarget() {
    if (!/\/groups\/|\/webinar(?:-foxford)?\//.test(location.pathname)) return null;
    let best = null;
    let bestScore = 74;
    const seen = new Set();
    for (const element of document.querySelectorAll(CANDIDATES.join(","))) {
      if (BLOCKED.some((selector) => element.closest(selector))) continue;
      const expanded = expandToAnswers(element);
      if (!expanded || seen.has(expanded)) continue;
      seen.add(expanded);
      const value = score(expanded);
      if (value > bestScore) { best = expanded; bestScore = value; }
    }
    return best;
  }

  function extractXpTask() {
    const root = findXpTarget();
    if (!root) return "";
    const text = extract(root);
    const details = extractAnswerDetails(root);
    const hasVisual = Boolean(root.querySelector("img, svg, canvas"));
    const condition = text || (hasVisual ? "Условие XP-задания находится на приложенном снимке." : "");
    if (!condition) return "";
    return clean([
      `XP-задание на уроке.\n${condition}`,
      details.options,
      details.mode
    ].filter(Boolean).join("\n\n")).slice(0, 8000);
  }

  function commonAncestor(first, second) {
    if (!first) return null;
    if (!second) return first;
    let current = first;
    while (current && !current.contains(second)) current = current.parentElement;
    return current;
  }

  function expandToAnswers(seed) {
    if (!seed) return null;
    const dialog = seed.closest('[role="dialog"], [aria-modal="true"]');
    if (dialog && visible(dialog) && clean(dialog.innerText || dialog.textContent).length < 20000) return dialog;
    let selected = seed;
    let current = seed;
    for (let depth = 0; current?.parentElement && depth < 10; depth += 1) {
      current = current.parentElement;
      const text = clean(current.innerText || current.textContent);
      const answerCount = current.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="option"], select').length;
      const rect = current.getBoundingClientRect();
      if (answerCount && text.length < 20000 && rect.width <= innerWidth * 1.15) selected = current;
      if (rect.width > innerWidth * 1.3 || text.length >= 20000) break;
    }
    return selected;
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
    const multiSelect = selects.some((select) => select.multiple || select.getAttribute("aria-multiselectable") === "true")
      || form.getAttribute?.("aria-multiselectable") === "true"
      || Boolean(form.querySelector('[aria-multiselectable="true"]'));

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
    form.querySelectorAll([
      '[role="option"]',
      '[data-testid*="answer"]',
      '[data-testid*="option"]',
      '[class*="answerOption" i]',
      '[class*="choice" i]'
    ].join(",")).forEach((option) => add(option.innerText || option.textContent));

    if (!checks.length && !radios.length && !selects.length && optionTexts.length > 1) {
      mode = "Формат ответа: на снимке есть варианты; выбери указанное в интерфейсе количество вариантов.";
    }

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
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height > 10000) throw new Error("Окно задачи слишком длинное для одного снимка.");
    const verticalPadding = 16;
    const overlap = 48;
    const paddedHeight = targetRect.height + verticalPadding * 2;

    const scroller = findScrollContainer(target);
    const documentScroller = document.scrollingElement || document.documentElement;
    const usesDocument = scroller === documentScroller;
    const safeTopInset = usesDocument ? usesSafeTopInset() : 12;
    const initialScroll = usesDocument ? window.scrollY : scroller.scrollTop;
    const scrollerRect = usesDocument ? { top: 0 } : scroller.getBoundingClientRect();
    const targetStart = usesDocument
      ? targetRect.top + window.scrollY
      : targetRect.top - scrollerRect.top + scroller.scrollTop;
    const paddedStart = targetStart - verticalPadding;
    const panel = document.getElementById(PANEL_ID);
    const previousVisibility = panel?.style.visibility || "";
    if (panel) panel.style.visibility = "hidden";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const segments = [];
      let covered = 0;
      for (let part = 0; part < 16 && covered < paddedHeight - 2; part += 1) {
        const segmentStart = part ? Math.max(0, covered - overlap) : 0;
        const requestedScroll = paddedStart + segmentStart - safeTopInset;
        if (usesDocument) window.scrollTo({ top: requestedScroll, left: window.scrollX, behavior: "instant" });
        else scroller.scrollTop = requestedScroll;
        await new Promise((resolve) => setTimeout(resolve, part ? 560 : 220));

        const rect = target.getBoundingClientRect();
        const bounds = usesDocument
          ? { left: 0, top: safeTopInset, right: innerWidth, bottom: innerHeight - 12 }
          : (() => {
              const current = scroller.getBoundingClientRect();
              return {
                left: Math.max(0, current.left),
                top: Math.max(0, current.top) + safeTopInset,
                right: Math.min(innerWidth, current.right),
                bottom: Math.min(innerHeight, current.bottom) - 12
              };
            })();
        const left = Math.max(bounds.left, rect.left);
        const paddedRectTop = rect.top - verticalPadding;
        const paddedRectBottom = rect.bottom + verticalPadding;
        const top = Math.max(bounds.top, paddedRectTop);
        const right = Math.min(bounds.right, rect.right);
        const bottom = Math.min(bounds.bottom, paddedRectBottom);
        const cssWidth = right - left;
        const cssHeight = bottom - top;
        const segmentTop = Math.max(0, top - paddedRectTop);
        if (cssWidth < 40 || cssHeight < 30) throw new Error("Часть окна задачи не видна на экране.");

        const response = await chrome.runtime.sendMessage({
          type: "FOXWEB_CAPTURE_TASK",
          capture: {
            rect: { left, top, width: cssWidth, height: cssHeight },
            viewport: { width: innerWidth, height: innerHeight }
          }
        });
        if (!response?.ok) throw new Error(response?.error || "Не удалось сделать часть снимка задачи.");
        segments.push({ imageDataUrl: response.imageDataUrl, top: segmentTop, cssWidth, cssHeight });
        const nextCovered = Math.max(covered, segmentTop + cssHeight);
        if (nextCovered <= covered + 2) break;
        covered = nextCovered;
      }

      if (covered < paddedHeight - 8) {
        throw new Error("Не удалось захватить окно задачи целиком. Прокрутите его к началу и повторите.");
      }
      const stitched = await chrome.runtime.sendMessage({
        type: "FOXWEB_STITCH_TASK",
        segments,
        target: { width: targetRect.width, height: paddedHeight }
      });
      if (!stitched?.ok) throw new Error(stitched?.error || "Не удалось склеить полный снимок задачи.");
      return stitched.imageDataUrl;
    } finally {
      if (usesDocument) window.scrollTo({ top: initialScroll, left: window.scrollX, behavior: "instant" });
      else scroller.scrollTop = initialScroll;
      if (panel) panel.style.visibility = previousVisibility;
    }
  }

  function findScrollContainer(element) {
    let current = element.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 5) return current;
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function usesSafeTopInset() {
    return Math.min(96, Math.max(64, Math.round(innerHeight * 0.12)));
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
