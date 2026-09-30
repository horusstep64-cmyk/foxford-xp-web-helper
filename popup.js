const service = document.querySelector("#service");
const status = document.querySelector("#status");

chrome.storage.local.get("service").then(({ service: saved }) => {
  service.value = saved || "chatgpt";
});

document.querySelector("#save").addEventListener("click", async () => {
  await chrome.storage.local.set({ service: service.value });
  status.textContent = "Сохранено ✓";
});
