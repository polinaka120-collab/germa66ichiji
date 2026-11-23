const STORAGE_KEY = "germa66_chat_v1";
const messagesEl = document.getElementById("messages");
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const typing = document.getElementById("typing");
const settingsModal = document.getElementById("settingsModal");
let history = [];
let busy = false;

function loadHistory() {
  try { history = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { history = []; }
  if (!Array.isArray(history)) history = [];
}
function saveHistory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-100))); }
  catch { /* Storage can be unavailable in private browsing. */ }
}
function addMessage(role, content, persist = true) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "assistant" ? "I" : "U";
  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";
  const sender = document.createElement("div");
  sender.className = "sender";
  sender.textContent = role === "assistant" ? "ICHИJI · GERMA 66" : "YOU";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  wrap.append(sender, bubble, time);
  article.append(avatar, wrap);
  messagesEl.append(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (persist) {
    history.push({ role, content });
    saveHistory();
  }
}
function renderHistory() {
  messagesEl.querySelectorAll(".message").forEach(node => node.remove());
  if (!history.length) {
    addMessage("assistant", "Канал снова открыт. Говори, что тебе нужно.", false);
    return;
  }
  for (const item of history) addMessage(item.role, item.content, false);
}
function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  typing.hidden = !value;
}
async function sendMessage(text) {
  const content = text.trim();
  if (!content || busy) return;
  addMessage("user", content);
  input.value = "";
  input.style.height = "auto";
  setBusy(true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-24) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось получить ответ.");
    addMessage("assistant", data.reply);
  } catch (error) {
    addMessage("assistant", `Связь прервана: ${error.message}`);
  } finally {
    setBusy(false);
    input.focus();
  }
}
form.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(input.value);
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById("menuBtn").addEventListener("click", async () => {
  settingsModal.hidden = false;
  try {
    const r = await fetch("/api/health");
    const data = await r.json();
    document.getElementById("connectionStatus").textContent = data.ready ? `Подключено · ${data.model}` : "Не настроен API-ключ на сервере";
    document.getElementById("statusPill").textContent = data.ready ? "READY" : "SETUP";
  } catch {
    document.getElementById("connectionStatus").textContent = "Сервер недоступен";
    document.getElementById("statusPill").textContent = "OFFLINE";
  }
});
document.getElementById("closeSettings").addEventListener("click", () => settingsModal.hidden = true);
settingsModal.addEventListener("click", e => { if (e.target === settingsModal) settingsModal.hidden = true; });
document.getElementById("clearBtn").addEventListener("click", () => {
  if (!confirm("Удалить локальную историю переписки?")) return;
  history = [];
  saveHistory();
  renderHistory();
  settingsModal.hidden = true;
});
document.getElementById("exportBtn").addEventListener("click", () => {
  const text = history.map(m => `${m.role === "assistant" ? "Ичиджи" : "Ты"}:\n${m.content}`).join("\n\n");
  const blob = new Blob([text || "История пуста."], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "germa66-chat.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

loadHistory();
renderHistory();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
