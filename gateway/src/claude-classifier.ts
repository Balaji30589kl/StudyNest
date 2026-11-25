import Anthropic from '@anthropic-ai/sdk';
import {
  buildClassificationUserMessage,
  CLASSIFIER_SYSTEM_PROMPT,
  PageMetadata,
  parseProviderPrediction,
  PREDICTION_JSON_SCHEMA,
  ProviderPrediction
} from '../../src/shared/classification.js';

export type Classifier = (metadata: PageMetadata, signal: AbortSignal) => Promise<ProviderPrediction>;

export class ClassifierError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ClassifierError';
  }
}

/** Extracts a JSON object from text that may be wrapped in prose or code fences. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Classifies a page with Claude using structured JSON output. Classification
 * is a short, high-volume task, so effort is low and the response small.
 */
export function createClaudeClassifier(options: { apiKey: string; model: string; client?: Anthropic }): Classifier {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1, timeout: 15_000 });

  return async (metadata, signal) => {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model: options.model,
          // Thinking tokens count toward max_tokens; leave room beyond the short JSON answer.
          max_tokens: 1024,
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: PREDICTION_JSON_SCHEMA as unknown as Record<string, unknown> }
          },
          system: CLASSIFIER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildClassificationUserMessage(metadata) }]
        },
        { signal }
      );
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ClassifierError('The gateway API key is invalid or lacks access to the model.', false);
      }
      if (error instanceof Anthropic.NotFoundError) {
        throw new ClassifierError('The configured model was not found.', false);
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ClassifierError('The LLM provider rate-limited the gateway.', true);
      }
      if (error instanceof Anthropic.BadRequestError) {
        throw new ClassifierError(`The LLM provider rejected the request: ${error.message}`, false);
      }
      if (error instanceof Anthropic.APIConnectionError) {
        throw new ClassifierError('Could not reach the LLM provider.', true);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ClassifierError(`LLM provider error ${error.status ?? ''}`.trim(), true);
      }
      throw new ClassifierError(error instanceof Error ? error.message : 'Unknown classifier error.', true);
    }

    if (response.stop_reason === 'refusal') {
      throw new ClassifierError('The model declined to classify this page.', false);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ClassifierError('The model response was truncated.', true);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const prediction = parseProviderPrediction(extractJsonObject(text));
    if (!prediction) {
      throw new ClassifierError('The model response did not match the classification schema.', true);
    }
    return prediction;
  };
}
