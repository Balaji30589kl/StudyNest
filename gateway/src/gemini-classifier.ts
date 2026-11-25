import {
  buildClassificationUserMessage,
  CLASSIFIER_SYSTEM_PROMPT,
  PageMetadata,
  parseProviderPrediction,
  PREDICTION_JSON_SCHEMA,
  ProviderPrediction
} from '../../src/shared/classification.js';
import { Classifier, ClassifierError, extractJsonObject } from './claude-classifier.js';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiPart = { text?: string; thought?: boolean };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

/** Finish reasons that mean the model declined or was stopped by a safety filter. */
const BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

function errorFor(status: number, payload: GeminiResponse | null): ClassifierError {
  const detail = payload?.error?.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403 || /api key/i.test(detail)) {
    return new ClassifierError('The gateway Gemini API key is invalid or lacks access to the model.', false);
  }
  if (status === 404) return new ClassifierError('The configured Gemini model was not found.', false);
  if (status === 429) return new ClassifierError('The LLM provider rate-limited the gateway.', true);
  if (status === 400) return new ClassifierError(`The LLM provider rejected the request: ${detail}`, false);
  return new ClassifierError(`LLM provider error ${status}`, true);
}

/** Errors worth retrying on the next model: overload, rate limits, outages, and retired models. */
function shouldTryNextModel(error: ClassifierError, status: number | null): boolean {
  return error.retryable || status === 404;
}

/** An HTTP-level failure of one model, which the next model may not share. */
class ModelError extends Error {
  constructor(
    readonly failure: ClassifierError,
    readonly status: number | null
  ) {
    super(failure.message);
  }
}

/**
 * Classifies a page with Google Gemini through its REST API, using the same
 * prompt and JSON schema as the Claude classifier.
 *
 * Gemini models (especially on the free tier) sometimes answer 503/429 and
 * sometimes stall for 30 s or more. Requests are therefore hedged: the first
 * model starts at once; if it has not answered after `hedgeAfterMs`, or fails
 * with an overload, rate limit or retired model, the next model starts too.
 * The first valid answer wins and the other requests are cancelled.
 */
/** How long a model may think before the next model is started alongside it. */
export const DEFAULT_HEDGE_AFTER_MS = 2500;

export function createGeminiClassifier(options: {
  apiKey: string;
  models: string[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  hedgeAfterMs?: number;
}): Classifier {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? GEMINI_API_BASE).replace(/\/+$/, '');
  const models = options.models.length > 0 ? options.models : ['gemini-flash-lite-latest'];

  async function classifyWith(model: string, metadata: PageMetadata, signal: AbortSignal): Promise<ProviderPrediction> {
    let response: Response;
    try {
      response = await doFetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CLASSIFIER_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: buildClassificationUserMessage(metadata) }] }],
          generationConfig: {
            // Room for any thinking tokens beyond the short JSON answer.
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseJsonSchema: PREDICTION_JSON_SCHEMA
          }
        })
      });
    } catch (error) {
      // Let the server map aborts to its own timeout response.
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ModelError(new ClassifierError('Could not reach the LLM provider.', true), null);
    }

    const payload = (await response.json().catch(() => null)) as GeminiResponse | null;
    if (!response.ok) {
      throw new ModelError(errorFor(response.status, payload), response.status);
    }
    if (payload?.promptFeedback?.blockReason) {
      throw new ClassifierError('The model declined to classify this page.', false);
    }

    const candidate = payload?.candidates?.[0];
    const finishReason = candidate?.finishReason ?? '';
    if (BLOCKED_FINISH_REASONS.has(finishReason)) {
      throw new ClassifierError('The model declined to classify this page.', false);
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new ClassifierError('The model response was truncated.', true);
    }

    const text = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    const prediction = parseProviderPrediction(extractJsonObject(text));
    if (!prediction) {
      throw new ClassifierError('The model response did not match the classification schema.', true);
    }
    return prediction;
  }

  const hedgeAfterMs = options.hedgeAfterMs ?? DEFAULT_HEDGE_AFTER_MS;

  return (metadata, signal) =>
    new Promise<ProviderPrediction>((resolve, reject) => {
      const running: AbortController[] = [];
      let nextModel = 0;
      let pending = 0;
      let settled = false;
      let last: ClassifierError | null = null;
      let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        signal.removeEventListener('abort', onCallerAbort);
        for (const controller of running) controller.abort();
        settle();
      };
      // The caller's own timeout ends everything; the server answers with a timeout.
      const onCallerAbort = () => finish(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      if (signal.aborted) {
        onCallerAbort();
        return;
      }
      signal.addEventListener('abort', onCallerAbort, { once: true });

      /** Starts the next model; false when every model has been started. */
      const startNext = (): boolean => {
        if (settled || nextModel >= models.length) return false;
        const model = models[nextModel++]!;
        const controller = new AbortController();
        running.push(controller);
        pending += 1;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        hedgeTimer = setTimeout(startNext, hedgeAfterMs);
        classifyWith(model, metadata, controller.signal).then(
          (prediction) => finish(() => resolve(prediction)),
          (error: unknown) => {
            pending -= 1;
            if (settled) return;
            if (error instanceof ModelError) {
              last = error.failure;
              if (!shouldTryNextModel(error.failure, error.status)) {
                finish(() => reject(error.failure));
                return;
              }
            } else if (error instanceof Error && error.name === 'AbortError') {
              last = new ClassifierError('The LLM provider took too long.', true);
            } else {
              // Declined, truncated or malformed answers are not a capacity problem.
              finish(() => reject(error));
              return;
            }
            if (!startNext() && pending === 0) {
              finish(() => reject(last ?? new ClassifierError('No Gemini model is configured.', false)));
            }
          }
        );
        return true;
      };

      startNext();
    });
}
