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
 * prompt and JSON schema as the Claude classifier. Gemini models are often
 * briefly overloaded (HTTP 503), so an overloaded, rate-limited or retired
 * model falls through to the next one in `models`.
 */
export function createGeminiClassifier(options: { apiKey: string; models: string[]; fetchImpl?: typeof fetch; baseUrl?: string }): Classifier {
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

  return async (metadata, signal) => {
    let last: ClassifierError | null = null;
    for (const model of models) {
      try {
        return await classifyWith(model, metadata, signal);
      } catch (error) {
        if (!(error instanceof ModelError)) throw error;
        last = error.failure;
        if (signal.aborted || !shouldTryNextModel(error.failure, error.status)) break;
      }
    }
    throw last ?? new ClassifierError('No Gemini model is configured.', false);
  };
}
