# Obiimy Chat Widget

AI chat widget for [obiimy.world](https://obiimy.world) — Вікторія, асистентка бренду «Обійми».

- **Live demo:** https://obiimy-chat.eon.plus/ (fullscreen chat, no bubble — that's intentional for the demo).
- **Embeddable bubble:** add `<script src="https://obiimy-chat.eon.plus/embed.js" data-position="bottom-right"></script>` to a host page; the widget mounts as a floating bubble.

## Architecture
- **Frontend** (`public/`): pure HTML/CSS/JS, ~600 lines. Two modes: `bubble` (floating chat) and `fullscreen` (whole-page chat). Mobile Safari fix via `100dvh` + JS-set `--ob-app-height` + sticky input + `env(safe-area-inset-*)`.
- **Backend** (`backend/`): Node.js 22 + Express, SSE streaming proxy. ~280 lines. No DB, in-memory rate limit.
- **LLMs:**
  - **Primary:** `gemini-2.5-flash` (`thinkingBudget: 256`, `maxOutputTokens: 2048`) — fast, empathic, scenario-following.
  - **Auto-upgrade to** `gemini-2.5-pro` (`thinkingBudget: 1024`) when Flash answer is too short / contains «не знаю» AND has no `[[SCENE:...]]` marker.
  - **Last-resort fallback:** GPT-4o (used when Gemini quotas hit).
- **Scenario images** (`public/assets/scenarios/<key>/{1..N}.webp`): 7 scenarios, 24 images extracted from the Google-Doc instructions, organized by intent (catalog / size demos / wrap / accessories).
  - Model emits `[[SCENE:key]]` inline; frontend parses and renders an inline gallery + lightbox.

## Endpoints
- `GET /api/health` — status, model versions, scenario count
- `GET /api/scenarios` — manifest of scenarios + image paths
- `POST /api/chat` — SSE stream (`{messages: [{role, content}], sessionId}`)

## Deployment
Live on the **agenteon** droplet (`46.101.190.165`), Caddy auto-TLS reverse proxy → 127.0.0.1:8090, pm2-managed.
Deploy/teardown workflow YAMLs are in `ops/` for reference.

## Local dev
```bash
cd backend
npm install
GEMINI_API_KEY=... OPENAI_API_KEY=... node server.js
# open http://localhost:8090
```
