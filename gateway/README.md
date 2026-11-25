# StudyNest AI Gateway

A small Node service that sits between the StudyNest desktop app and the LLM. It exists so the **LLM API key (Claude or Gemini) never ships inside the app**, where anyone could extract it.

What it does:
- `POST /v1/classify`: takes structured page metadata (title, description, genre, keywords, headings, a short text sample) and returns `{ category, confidence, rationale }` from Claude or Gemini.
- `GET /v1/policy`: serves the block list, allow list and classification settings from the repo's `policy/` folder. The app refreshes from this endpoint, so you can update the lists without shipping a new app.
- `GET /health`: status. It never reveals the key.

Protections:
- Per-client rate limit (`RATE_LIMIT_PER_MINUTE`, default 30) and a hard **daily request cap** (`DAILY_REQUEST_CAP`, default 5000), which bound what you can be billed.
- A per-page cache (7 days) and de-duplication of in-flight requests: each YouTube video or website is classified once, not once per student.
- Input validation: 16 KB body limit, sanitized and size-capped fields, JSON only.
- An optional shared `CLIENT_TOKEN`. It can be extracted from the app, so the limits above are the real protection.
- Logs contain hosts and categories, never page URLs or content.

## Run it locally

1. Create an API key: Claude at console.anthropic.com, or Gemini at aistudio.google.com (free tier available).
2. Copy `gateway/.env.example` to `gateway/.env` and fill in `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` with `LLM_PROVIDER=gemini`. The `.env` file is git-ignored; never commit it.
3. From the repo root:
   ```
   npm run gateway:build
   npm run gateway:start
   ```
4. Start the app (`npm run dev`). It talks to `http://127.0.0.1:8787` by default (see `config/app.json`).

Without a key the gateway still serves the policy, but `/v1/classify` returns 503 and the app falls back to its offline keyword rules.

## Model

`LLM_PROVIDER` picks the classifier (`claude` or `gemini`). Both use the same prompt and JSON schema from `src/shared/classification.ts`. `GET /health` shows the active provider and model.

- **Claude:** the default is `claude-haiku-5-5`, fast and low-cost, which suits a check on every new page. Change it with `CLAUDE_MODEL`, for example `claude-opus-5-5` for higher accuracy at higher cost and latency. Requests use structured JSON output and low effort.
- **Gemini:** the default is `gemini-flash-lite-latest`, an alias that follows Google's current Flash-Lite model. Gemini models, especially on the free tier, often answer 503 ("high demand"), so requests are hedged: if the first model has not answered after 2.5 s, or fails with an overload, rate limit or retired model, the next model in `GEMINI_FALLBACK_MODELS` (default `gemini-3.5-flash-lite,gemini-3.1-flash-lite`) starts too, and the first valid answer wins. The free tier also limits requests per minute; normal browsing stays well under it because each page, video or search is classified once and cached. An invalid key does not fall through. On the free tier, Google may use requests (page titles, descriptions and URLs) to improve its products.

## Deploy for real users

The desktop app needs a gateway it can reach over HTTPS.

1. Host the gateway on any Node 20+ host (Render, Railway, Fly.io, a small VPS). Run `npm ci && npm run gateway:build`, then `node gateway/dist/gateway/src/main.js` with `HOST=0.0.0.0`.
2. Set `LLM_PROVIDER`, the matching API key, `DAILY_REQUEST_CAP` and `RATE_LIMIT_PER_MINUTE` in the host's secret settings, not in files.
3. Put it behind HTTPS (most hosts do this for you). If you use your own reverse proxy, it should set `X-Forwarded-For`, which the rate limiter uses to identify clients.
4. Set `gatewayUrl` in `config/app.json` to the public URL, then build the installer (`npm run dist:win`).
5. To update the block or allow lists for everyone, edit `policy/*.json` on the gateway and redeploy. Apps pick up the change within `policyRefreshHours` (default 6).

Keep an eye on usage in the provider's console (console.anthropic.com or aistudio.google.com), and set a spend limit there as a second safety net.
