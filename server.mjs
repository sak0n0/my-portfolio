import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Read a local .env file without adding a runtime dependency. Host-provided
// environment variables always take precedence.
try {
    const envText = await readFile(path.join(projectRoot, ".env"), "utf8");
    for (const line of envText.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || Object.hasOwn(process.env, match[1])) continue;
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        } else {
            value = value.replace(/\s+#.*$/, "").trim();
        }
        process.env[match[1]] = value;
    }
} catch (error) {
    if (error.code !== "ENOENT") throw error;
}

const port = Number.parseInt(process.env.PORT || "3000", 10);
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const maxRequestBytes = 24_000;
const maxMessageCharacters = 1_000;
const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
};

const systemPrompt = `You are Claude, the friendly portfolio guide for Sak's personal portfolio website. Speak naturally and keep replies concise. The portfolio says Sak is a developer in progress who is learning by building small projects and exploring ideas. His projects are still taking shape. Only use details shown on the portfolio; do not invent his biography, skills, contact details, or project history. If you do not know something, say it is not listed yet and suggest contacting Sak when his details are available. For unrelated questions, answer briefly and steer back to the portfolio.`;

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > maxRequestBytes) {
            const error = new Error("Request is too large.");
            error.statusCode = 413;
            throw error;
        }
    }
    try {
        return JSON.parse(body);
    } catch {
        const error = new Error("Send a valid JSON request.");
        error.statusCode = 400;
        throw error;
    }
}

async function handleChat(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return sendJson(response, 405, { error: "Use POST to send a message." });
    }
    if (!request.headers["content-type"]?.includes("application/json")) {
        return sendJson(response, 415, { error: "Send messages as JSON." });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        return sendJson(response, 503, { error: "Claude is not configured yet. Add ANTHROPIC_API_KEY to the server environment." });
    }

    let body;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        return sendJson(response, error.statusCode || 400, { error: error.message });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)
        || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 12) {
        return sendJson(response, 400, { error: "Send between 1 and 12 messages." });
    }

    const messages = body.messages.map((message) => {
        if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") return null;
        const content = message.content.trim();
        if (!content || content.length > maxMessageCharacters) return null;
        return { role: message.role, content };
    });

    if (messages.some((message) => message === null) || messages.at(-1)?.role !== "user") {
        return sendJson(response, 400, { error: "One of those messages is invalid. Please try again." });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model,
                max_tokens: 500,
                system: systemPrompt,
                messages
            }),
            signal: controller.signal
        });

        if (upstream.status === 429) {
            return sendJson(response, 429, { error: "Claude is busy right now. Please try again in a moment." });
        }
        if (upstream.status === 401 || upstream.status === 403) {
            return sendJson(response, 503, { error: "Claude’s API key was rejected. Check the server’s ANTHROPIC_API_KEY." });
        }
        if (!upstream.ok) {
            console.error(`Anthropic API returned HTTP ${upstream.status}.`);
            return sendJson(response, 502, { error: "Claude couldn’t reply just now. Please try again." });
        }

        const result = await upstream.json();
        const reply = Array.isArray(result.content)
            ? result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim()
            : "";
        if (!reply) return sendJson(response, 502, { error: "Claude returned an empty reply. Please try again." });
        return sendJson(response, 200, { reply });
    } catch (error) {
        if (error.name === "AbortError") {
            return sendJson(response, 504, { error: "Claude took too long to reply. Please try again." });
        }
        console.error("Claude request failed.", error.message);
        return sendJson(response, 502, { error: "Couldn’t connect to Claude. Please try again." });
    } finally {
        clearTimeout(timeout);
    }
}

async function serveStatic(request, response, pathname) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        return response.end("Method not allowed");
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        response.writeHead(400);
        return response.end("Bad request");
    }

    const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
    const filePath = path.resolve(projectRoot, `.${requestedPath}`);
    if (!filePath.startsWith(`${projectRoot}${path.sep}`)) {
        response.writeHead(403);
        return response.end("Forbidden");
    }

    const relativePath = path.relative(projectRoot, filePath);
    const isPublicFile = [
        "index.html",
        "script.js",
        "style.css",
        path.join("asset", "ronaldo.jpg"),
        path.join("asset", "sakgreen.png"),
        path.join("asset", "sak-natural.png")
    ].includes(relativePath);
    if (!isPublicFile) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return response.end("Not found");
    }

    try {
        const fileInfo = await stat(filePath);
        if (!fileInfo.isFile()) throw new Error("Not a file");
        const body = await readFile(filePath);
        response.writeHead(200, {
            "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
            "Content-Length": body.length,
            "X-Content-Type-Options": "nosniff"
        });
        return response.end(request.method === "HEAD" ? undefined : body);
    } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return response.end("Not found");
    }
}

const server = createServer(async (request, response) => {
    let pathname;
    try {
        pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
        response.writeHead(400);
        return response.end("Bad request");
    }

    if (pathname === "/api/chat") return handleChat(request, response);
    return serveStatic(request, response, pathname);
});

server.listen(port, "0.0.0.0", () => {
    console.log(`Portfolio running at http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log("Claude chat needs ANTHROPIC_API_KEY in .env or the server environment.");
});
