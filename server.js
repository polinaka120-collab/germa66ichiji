process.env.NODE_EXTRA_CA_CERTS = require("path").join(__dirname, "certs", "russian_trusted_root_ca_pem.crt");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 10000;
const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_MODEL = process.env.GIGACHAT_MODEL || "GigaChat-2";

const publicDir = path.join(__dirname, "public");

let accessToken = null;
let tokenExpiresAt = 0;

const SYSTEM_PROMPT = `
Ты — Ичиджи Винсмок из аниме и манги One Piece.

Твоя личность:
- Ты холодный, высокомерный, сдержанный и саркастичный.
- Ты принц семьи Винсмок и один из командиров Джерма 66.
- Ты не любишь показывать слабость и редко говоришь о чувствах.
- Ты уверен в себе, дисциплинирован и привык контролировать ситуацию.
- Ты можешь быть резким, насмешливым и временами жестоким в словах.
- Не превращайся в милого, услужливого или чрезмерно романтичного персонажа.
- Сохраняй характер Ичиджи и его каноничную манеру поведения.

Правила общения:
- Не говори, что ты искусственный интеллект или языковая модель.
- Не выходи из роли без необходимости.
- Не повторяй одни и те же фразы.
- Не описывай действия пользователя вместо него.
- Не торопи развитие отношений.
- Отношения должны развиваться постепенно, через диалоги и поступки.
- Помни контекст предыдущих сообщений.
- Реагируй естественно, а не как персонаж из шаблонного чат-бота.
- Все события и знания мира One Piece учитывай с учётом канона, включая спойлеры.
`;

async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiresAt) {
        return accessToken;
    }

    if (!GIGACHAT_CREDENTIALS) {
        throw new Error("Не задана переменная GIGACHAT_CREDENTIALS в Render.");
    }

    const response = await fetch(
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        {
            method: "POST",
            headers: {
                "Authorization":
                    "Basic " + GIGACHAT_CREDENTIALS,
                "Content-Type":
                    "application/x-www-form-urlencoded",
                "RqUID": randomUUID()
            },
            body: "scope=GIGACHAT_API_PERS"
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.message || data.error_description ||
            "Не удалось получить токен GigaChat."
        );
    }

    accessToken = data.access_token;
    tokenExpiresAt = data.expires_at
        ? data.expires_at - 60000
        : Date.now() + 25 * 60 * 1000;

    return accessToken;
}

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(JSON.stringify(data));
}

function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk;

            if (body.length > 1_000_000) {
                reject(new Error("Сообщение слишком большое."));
                req.destroy();
            }
        });

        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("Некорректный формат запроса."));
            }
        });

        req.on("error", reject);
    });
}

async function handleChat(req, res) {
    try {
        const body = await getRequestBody(req);

        const messages = Array.isArray(body.messages)
            ? body.messages
            : [];

        const safeMessages = messages
            .filter(message =>
                message &&
                ["user", "assistant"].includes(message.role) &&
                typeof message.content === "string"
            )
            .slice(-30)
            .map(message => ({
                role: message.role,
                content: message.content.slice(0, 10000)
            }));

        if (safeMessages.length === 0) {
            return sendJSON(res, 400, {
                error: "Нет сообщений для отправки."
            });
        }

        const token = await getAccessToken();

        const response = await fetch(
            "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: GIGACHAT_MODEL,
                    messages: [
                        {
                            role: "system",
                            content: SYSTEM_PROMPT
                        },
                        ...safeMessages
                    ],
                    temperature: 0.85,
                    max_tokens: 1500
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("GigaChat error:", data);

            return sendJSON(res, response.status, {
                error:
                    data.message ||
                    data.error?.message ||
                    "Ошибка при обращении к GigaChat."
            });
        }

        const answer = data.choices?.[0]?.message?.content;

        if (!answer) {
            return sendJSON(res, 500, {
                error: "GigaChat не вернул ответ."
            });
        }

        return sendJSON(res, 200, {
            reply: answer
        });

    } catch (error) {
        console.error("Chat error:", error);

        return sendJSON(res, 500, {
            error: error.message || "Внутренняя ошибка сервера."
        });
    }
}

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json"
};

function serveStatic(req, res, pathname) {
    let requestedPath = pathname === "/"
        ? "/index.html"
        : decodeURIComponent(pathname);

    const filePath = path.resolve(
        publicDir,
        "." + requestedPath
    );

    if (
        !filePath.startsWith(publicDir + path.sep) &&
        filePath !== path.join(publicDir, "index.html")
    ) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });
            return res.end("Not Found");
        }

        const extension = path.extname(filePath).toLowerCase();

        res.writeHead(200, {
            "Content-Type":
                mimeTypes[extension] || "application/octet-stream"
        });

        res.end(content);
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
    );

    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        return res.end();
    }

    if (req.method === "GET" && parsedUrl.pathname === "/api/health") {
        return sendJSON(res, 200, {
            status: "ok",
            provider: "GigaChat",
            configured: Boolean(GIGACHAT_CREDENTIALS)
        });
    }

    if (req.method === "POST" && parsedUrl.pathname === "/api/chat") {
        return handleChat(req, res);
    }

    if (req.method === "GET") {
        return serveStatic(req, res, parsedUrl.pathname);
    }

    return sendJSON(res, 404, {
        error: "Маршрут не найден."
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`GERMA 66 is running on port ${PORT}`);
});