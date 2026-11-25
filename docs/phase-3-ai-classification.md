# Phase 3 AI Classification Implementation Guide

## Goal
Let StudyNest judge pages that aren't on either list, without letting AI decide anything. Providers **predict** a category, and the deterministic Phase 2 policy **decides**.

## What Was Built
- Page metadata extraction in an isolated JavaScript world: title, description, keywords, h1/h2 headings, og tags, language, and an 800-character visible-text sample. Everything is size-capped and sanitized. No cookies, storage, form values, or full HTML.
- An AI gateway (`src/main/ai/ai-gateway.ts`), the single entry point for classification, with:
  - Provider abstraction (`ClassificationProvider`) and three providers:
    - **rule-based** (default): an offline keyword classifier. No data leaves the device.
    - **local**: any `/chat/completions` model server (Ollama, LM Studio, llama.cpp).
    - **anthropic**: Claude through the official `@anthropic-ai/sdk`, with structured JSON output (`output_config.format`), `effort: low`, and server-side refusal fallbacks (`fallbacks: "default"`). The default model is `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper and can be set in Settings.
  - A per-host LRU cache (500 entries; 7-day TTL, or 1 hour for fallback answers), persisted to `userData/ai-data.json`.
  - In-flight de-duplication, a 12-second timeout with abort, and fallback to the rule-based provider when the selected provider errors, times out, or isn't configured.
  - Stats: requests, cache hits, provider calls, fallbacks, and the last error.
- Policy integration: an `aiAssist` section in Study settings (enabled, warn/block, minimum confidence, distracting categories).
- The API key is stored encrypted with Electron `safeStorage` (`userData/ai-key.bin`), or read from `ANTHROPIC_API_KEY`. It never reaches the renderer; snapshots only report its source.
- UI: a provider picker, key/model/endpoint settings, cache stats and recent predictions in Settings; AI-assist rules in the Study panel; the prediction shown on the interstitial; and a `classified` event in the activity log.

## Separation of Prediction and Enforcement

```
page loads (unlisted, during a session)
  → TabManager.onPageLoaded            generic shell event, no AI knowledge
  → StudyModeService.shouldClassify    is a prediction even relevant?
  → extractPageMetadata                isolated world, sanitized
  → AiGateway.classify                 cache → provider → fallback
  → StudyModeService.recordClassification
  → policy change → TabManager.revalidateTabs
  → evaluateStudyPolicy(url, { classification })   deterministic decision
```

Rules that keep the layers honest:
- `applyClassification` can only change an **allow / unlisted** decision. Allow-list and block-list rules, session overrides, search, strict mode, and "study off" are decided first and are never touched by a prediction.
- A prediction applies only if its category is one the user marked distracting **and** its confidence meets their threshold. The default action is **warn**, because predictions can be wrong.
- Providers never see policy settings. The service never imports a provider: it only receives `classificationLookup(url)`, a synchronous, read-only view of the gateway cache.
- Swapping providers changes nothing in the browser or policy code. Changing provider or model clears the cache, so stale predictions are not reused.
- Classification runs only during a session, only when AI assist is on, and only for pages a prediction could affect.

## Before-Render Blocking on Repeat Visits
The first visit to an unlisted distracting site renders briefly while it is classified, then the tab switches to the warning page. On later visits the cached prediction is available synchronously to the `onBeforeRequest` guard, so the request is cancelled before it is sent. The smoke test confirms this by counting server hits.

## Prompt-Injection Posture
Page metadata is untrusted. The system prompt tells the model to treat it as data, and the metadata is wrapped in `<page_metadata>` as JSON. The output is constrained to a JSON schema and then re-validated (`parseProviderPrediction`): the category must come from a fixed set and confidence is clamped. The worst case of a successful injection is a wrong category for an *unlisted* site, which the user can override with one allow-list entry.

## Verification

Automated (`npm test`, 80 tests in total at the end of this phase):
- Classification contract: metadata caps and strict prediction parsing.
- Policy precedence: explicit rules beat predictions, plus threshold, categories, the tighten-only rule, and sanitizing.
- Rule-based classifier on clear and empty pages.
- Gateway: cache, de-duplication, fallback, timeout with abort, TTL, persistence, provider-swap invalidation, config validation, and that the key is never exposed.
- Anthropic provider (fake client): request shape (model, structured output, low effort, fallbacks), refusal handling, and schema rejection.
- Local provider (fake fetch): endpoint shape and HTTP errors.
- Service integration: `shouldClassify` gating, classified interstitial, and no effect outside sessions.

End to end (built app, offline rule-based provider, local test page):
1. No classification outside a session.
2. During a session, a streaming-style page is classified `entertainment 95%`, switches to the warning page, and is logged.
3. A repeat visit is intercepted **before reaching the server**, with no extra provider call.
4. Adding the host to the allow list beats the prediction.

Manual with Claude: Settings → AI classification → Claude → paste a key → start a session → open an unlisted site. The Provider calls counter goes up once per new host.
