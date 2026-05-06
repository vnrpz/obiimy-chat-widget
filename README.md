# Obiimy Chat Widget

AI chat widget for [obiimy.world](https://obiimy.world) — Вікторія, асистентка бренду «Обійми».

- **Frontend**: pure HTML/CSS/JS, embeddable like Intercom (single `<script>` tag).
- **Backend**: Node.js + Express, SSE streaming proxy.
  - **Primary**: `gemini-2.5-flash` (`thinkingBudget: 512`) — fast, empathic, cheap.
  - **Auto-upgrade to** `gemini-2.5-pro` (`thinkingBudget: 1024`) when Flash answer is short / contains "не знаю" — heuristic-driven, ~24× cheaper than Pro-only baseline.
  - **Last-resort fallback**: GPT-4o.
- **Deploy**: belgravia droplet (`209.38.244.71`), nginx + pm2, auto-deployed via GitHub Actions.
- **Public URL**: https://obiimy-chat.eon.plus/

## Embed snippet
```html
<script src="https://obiimy-chat.eon.plus/embed.js" data-position="bottom-right"></script>
```

## Endpoints
- `GET /api/health` — status
- `POST /api/chat` — SSE-streamed chat (`{ messages: [{role, content}], sessionId }`)

## Local dev
```bash
cd backend
npm install
GEMINI_API_KEY=... node server.js
# open http://localhost:8090
```
