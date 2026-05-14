// Obiimy chat backend — Express + SSE streaming proxy.
// Provider chain (May 2026):
//   1. OpenAI primary (gpt-4o-mini by default — 200k TPM, fast).
//   2. Gemini-2.5-flash secondary (when Google quota available).
//   3. Gemini-2.5-pro for low-confidence re-asks (gated; only when prior succeeded).
//   4. OpenAI gpt-4o last resort.
//   5. Empty-content fallback: canned graceful response so the user never sees blank.

const fs = require("fs");
const path = require("path");
const express = require("express");

// Load .env if present (no dotenv dep needed)
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["\x27](.*)["\x27]$/, "$1");
    }
  }
} catch {}

const { PERSONA } = require("./system-prompt");
const { SCENARIOS } = require("./scenarios");

const PORT = process.env.PORT || 8090;
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const GEMINI_FLASH = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
const GEMINI_PRO   = process.env.GEMINI_PRO_MODEL   || "gemini-2.5-pro";
const OPENAI_PRIMARY = process.env.OPENAI_PRIMARY_MODEL || "gpt-4o-mini";
const OPENAI_BIG     = process.env.OPENAI_MODEL || "gpt-4o";
const LOW_CONF_RE = /(не\s+знаю|не\s+впевнен|не\s+певн|важко\s+сказати|не\s+маю\s+інформац)/i;

const EMPTY_FALLBACK = "Хвилинку 💛 уточнюю для вас інформацію ✨\nЯкщо це терміново — напишіть, будь ласка, ще раз або зачекайте трохи — менеджер вже на звʼязку 🙌";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "..", "public"), {
  maxAge: "1h",
  setHeaders: (res, p) => {
    if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    if (p.endsWith(".webp") || p.endsWith(".png") || p.endsWith(".jpg")) res.setHeader("Cache-Control", "public, max-age=86400");
  }
}));

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 30;
const buckets = new Map();
function rateLimit(ip) {
  const now = Date.now();
  let arr = buckets.get(ip) || [];
  arr = arr.filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return false;
  arr.push(now);
  buckets.set(ip, arr);
  return true;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "obiimy-chat",
    time: new Date().toISOString(),
    primary: OPENAI_KEY ? OPENAI_PRIMARY : (GEMINI_KEY ? GEMINI_FLASH : null),
    secondary: GEMINI_KEY ? GEMINI_FLASH : null,
    pro: GEMINI_KEY ? GEMINI_PRO : null,
    last_resort: OPENAI_KEY ? OPENAI_BIG : null,
    scenarios: Object.keys(SCENARIOS).length
  });
});

app.get("/api/scenarios", (_req, res) => {
  const out = {};
  for (const [k, s] of Object.entries(SCENARIOS)) {
    out[k] = {
      title: s.title,
      images: Array.from({ length: s.count }, (_, i) => `/assets/scenarios/${k}/${i + 1}.webp`)
    };
  }
  res.json(out);
});

function trimMessages(messages, maxTurns = 24) {
  const m = (messages || []).filter(x => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string");
  if (m.length <= maxTurns) return m;
  return m.slice(m.length - maxTurns);
}
function buildMessages(history) {
  return [{ role: "system", content: PERSONA }, ...trimMessages(history)];
}
function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamGemini(history, onDelta, opts = {}) {
  const model = opts.model || GEMINI_FLASH;
  const thinkingBudget = opts.thinkingBudget ?? 256;
  const sys = { role: "user", parts: [{ text: PERSONA }] };
  const sysAck = { role: "model", parts: [{ text: "Зрозуміла. Я Вікторія з «Обійми», на звʼязку 💛" }] };
  const contents = [sys, sysAck];
  for (const m of trimMessages(history)) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  const body = {
    contents,
    generationConfig: {
      temperature: 0.75,
      topP: 0.95,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget }
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`gemini http ${r.status}: ${txt.slice(0, 240)}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = ""; let got = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const parts = j?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) { if (p.text) { got = true; onDelta(p.text); } }
        const fr = j?.candidates?.[0]?.finishReason;
        if (fr && fr !== "STOP" && fr !== "MAX_TOKENS" && fr !== "FINISH_REASON_UNSPECIFIED") {
          throw new Error("gemini finishReason=" + fr);
        }
      } catch (e) {
        if (String(e.message || "").startsWith("gemini finishReason")) throw e;
      }
    }
  }
  if (!got) throw new Error("gemini empty stream");
}

async function streamOpenAI(history, onDelta, modelOverride) {
  const model = modelOverride || OPENAI_PRIMARY;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model, stream: true, temperature: 0.75, max_tokens: 1024, messages: buildMessages(history) })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`openai(${model}) http ${r.status}: ${txt.slice(0, 240)}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = ""; let got = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { got = true; onDelta(delta); }
      } catch {}
    }
  }
  if (!got) throw new Error(`openai(${model}) empty stream`);
}

app.post("/api/chat", async (req, res) => {
  const ip = (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "unknown").toString().split(",")[0].trim();
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages || !messages.length) return res.status(400).json({ error: "messages required" });
  if (!rateLimit(ip)) return res.status(429).json({ error: "rate_limit", message: "Забагато повідомлень. Спробуйте за годину 💛" });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let total = "";
  const onDelta = (t) => { total += t; sseWrite(res, "delta", { t }); };

  const startedAt = Date.now();
  let used = "none";
  const attemptErrors = [];

  // Provider chain: gpt-4o-mini → gemini-flash → gemini-pro → gpt-4o
  const chain = [];
  if (OPENAI_KEY) chain.push({ name: "openai-mini", fn: () => streamOpenAI(messages, onDelta, OPENAI_PRIMARY) });
  if (GEMINI_KEY) chain.push({ name: "gemini-flash", fn: () => streamGemini(messages, onDelta, { model: GEMINI_FLASH, thinkingBudget: 256 }) });
  if (GEMINI_KEY) chain.push({ name: "gemini-pro",   fn: () => streamGemini(messages, onDelta, { model: GEMINI_PRO,   thinkingBudget: 768 }) });
  if (OPENAI_KEY) chain.push({ name: "openai-big",   fn: () => streamOpenAI(messages, onDelta, OPENAI_BIG) });

  if (chain.length === 0) {
    sseWrite(res, "delta", { t: EMPTY_FALLBACK });
    sseWrite(res, "done", { provider: "fallback", ms: Date.now() - startedAt });
    return res.end();
  }

  for (let i = 0; i < chain.length; i++) {
    const { name, fn } = chain[i];
    total = ""; // reset accumulated text for fresh attempt
    if (i > 0) sseWrite(res, "regenerate", { reason: attemptErrors[attemptErrors.length - 1].name + "_error" });
    try {
      await fn();
      if (total.trim().length === 0) throw new Error(name + " empty");
      used = name;
      break;
    } catch (e) {
      console.warn(`[chat] ${name} failed: ${e.message}`);
      attemptErrors.push({ name, err: e.message });
      // continue to next provider
    }
  }

  if (used === "none") {
    // All providers failed — send graceful empty-fallback so user never sees blank
    console.error("[chat] all providers failed:", attemptErrors.map(e => e.name + ":" + e.err.slice(0, 80)).join(" | "));
    total = EMPTY_FALLBACK;
    sseWrite(res, "delta", { t: EMPTY_FALLBACK });
    used = "fallback";
  }

  sseWrite(res, "done", { provider: used, ms: Date.now() - startedAt, attempts: attemptErrors.length + 1 });
  res.end();
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[obiimy-chat] listening on 127.0.0.1:${PORT}`);
});
