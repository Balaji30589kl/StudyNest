import { PageMetadata, parseProviderPrediction, ProviderPrediction } from '../../shared/classification.js';
import { ClassificationProvider, ProviderError } from './provider.js';

type GatewayProviderOptions = {
  getUrl: () => string;
  getToken?: () => string | null;
  fetchImpl?: typeof fetch;
};

/**
 * Classifies through the StudyNest AI gateway, which holds the LLM key.
 * The desktop app never sees or stores a provider API key.
 */
export class GatewayProvider implements ClassificationProvider {
  readonly id = 'gateway';
  readonly label = 'StudyNest AI gateway';

  constructor(private readonly options: GatewayProviderOptions) {}

  isAvailable(): boolean {
    try {
      const url = new URL(this.options.getUrl());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async classify(metadata: PageMetadata, signal: AbortSignal): Promise<ProviderPrediction> {
    const base = this.options.getUrl().replace(/\/+$/, '');
    const token = this.options.getToken?.() ?? null;
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(`${base}/v1/classify`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ metadata })
      });
    } catch (error) {
      throw new ProviderError(this.id, error instanceof Error && error.name === 'AbortError' ? 'Gateway timed out.' : 'Gateway unreachable.');
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const reason = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
      throw new ProviderError(this.id, reason);
    }
    const prediction = parseProviderPrediction(payload);
    if (!prediction) {
      throw new ProviderError(this.id, 'Gateway response did not match the classification schema.');
    }
    return prediction;
  }
}
