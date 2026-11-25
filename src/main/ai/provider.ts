import type { PageMetadata, ProviderPrediction } from '../../shared/classification.js';

/**
 * A classification backend. Providers predict a category and nothing else:
 * they never see policy settings and never decide what happens to a page.
 */
export interface ClassificationProvider {
  readonly id: string;
  readonly label: string;
  /** False when required configuration (API key, endpoint) is missing. */
  isAvailable(): boolean;
  classify(metadata: PageMetadata, signal: AbortSignal): Promise<ProviderPrediction>;
}

export class ProviderError extends Error {
  constructor(
    readonly providerId: string,
    message: string
  ) {
    super(`[${providerId}] ${message}`);
    this.name = 'ProviderError';
  }
}
