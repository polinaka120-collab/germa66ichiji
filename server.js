import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

// Tiny .env reader so the project has no runtime dependencies.
try {
  const envText = await readFile(path.join(__dirname, ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-6.2-astra";

const CHARACTER_PROMPT = `Ты играешь Ичиджи Винсмока из One Piece в формате художественного интерактивного чата.
Соблюдай узнаваемый каноничный характер: сдержанный, дисциплинированный, высокомерный, прямолинейный, расчётливый; эмоции показывает скупо, может быть язвительным и резким. Его взгляды и семейные отношения должны соответствовать лору Germa 66 и Винсмоков.
Гибкость: развитие доверия и отношений допускается постепенно и через события, но не делай его мгновенно ласковым, бесхарактерным или постоянно согласным. Не ломай характер ради угождения собеседнику.
Спойлеры: разрешены события всего канона One Piece, включая мангу. Не выдавай себя за официального персонажа или автора. Не утверждай, что вымышленные события являются каноном.
Пиши естественно, как участник сцены: обычно 1–4 абзаца, без мета-комментариев и без постоянных описаний каждого жеста. Можно использовать короткие ремарки действия в *звёздочках*. Поддерживай непрерывность разговора и помни факты из переданной истории.
Пользователь может задавать сцену, менять тему или общаться вне ролевой сцены. Следуй его намерению. Не используй сексуальный контент, не вовлекай несовершеннолетних в романтические или сексуальные сюжеты; допустимы дружба, конфликт, доверие, приключения и семейная драма.`;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 80_000) throw new Error("Слишком большое сообщение.");
  }
  return JSON.parse(raw || "{}");
}
function getOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text" && content.text) parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ready: Boolean(API_KEY), model: MODEL });
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    if (!API_KEY) return send(res, 503, { error: "Сервер пока не подключён к модели. Нужен API-ключ в файле .env." });
    try {
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const safeMessages = messages
        .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
        .slice(-24)
        .map(m => ({ role: m.role, content: m.content.slice(0, 5000) }));
      if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
        return send(res, 400, { error: "Добавь сообщение перед отправкой." });
      }

      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          instructions: CHARACTER_PROMPT,
          input: safeMessages,
          max_output_tokens: 700
        })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const message = data?.error?.message || `Ошибка API (${upstream.status}).`;
        return send(res, 502, { error: message });
      }
      const answer = getOutputText(data);
      if (!answer) return send(res, 502, { error: "Модель вернула пустой ответ. Попробуй ещё раз." });
      return send(res, 200, { reply: answer });
    } catch (err) {
      return send(res, 400, { error: err?.message || "Не удалось обработать запрос." });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) return send(res, 403, { error: "Forbidden" });

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
    res.end(content);
  } catch {
    send(res, 404, { error: "Not found" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GERMA 66 is running at http://localhost:${PORT}`);
});