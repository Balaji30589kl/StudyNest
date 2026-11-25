import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LlmProvider = 'claude' | 'gemini';

export type GatewayConfig = {
  host: string;
  port: number;
  /** Which LLM classifies pages. */
  provider: LlmProvider;
  /** The API key for `provider`. */
  apiKey: string | null;
  model: string;
  /** Models tried in order when the previous one is overloaded or retired (Gemini only). */
  fallbackModels: string[];
  ratePerMinute: number;
  dailyCap: number;
  clientToken: string | null;
  policyDir: string;
  classifyTimeoutMs: number;
};

export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** Fast, low-cost Gemini alias that tracks the current Flash-Lite model. */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
export const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-3.1-flash-lite'];

function list(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/gateway/src -> repo root, or gateway/src -> repo root.
const DEFAULT_POLICY_DIR = path.resolve(here, here.includes(`${path.sep}dist${path.sep}`) ? '../../../../policy' : '../../policy');

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** LLM_PROVIDER wins; otherwise Gemini only when it is the one key configured. */
function readProvider(env: Record<string, string | undefined>): LlmProvider {
  const requested = nonEmpty(env.LLM_PROVIDER)?.toLowerCase();
  if (requested === 'claude' || requested === 'gemini') {
    return requested;
  }
  return nonEmpty(env.GEMINI_API_KEY) && !nonEmpty(env.ANTHROPIC_API_KEY) ? 'gemini' : 'claude';
}

export function readConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const provider = readProvider(env);
  return {
    host: nonEmpty(env.HOST) ?? '127.0.0.1',
    port: positiveInt(env.PORT, 8787),
    provider,
    apiKey: provider === 'gemini' ? nonEmpty(env.GEMINI_API_KEY) : nonEmpty(env.ANTHROPIC_API_KEY),
    model: provider === 'gemini' ? (nonEmpty(env.GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL) : (nonEmpty(env.CLAUDE_MODEL) ?? DEFAULT_MODEL),
    fallbackModels: provider === 'gemini' ? (list(env.GEMINI_FALLBACK_MODELS) ?? [...DEFAULT_GEMINI_FALLBACK_MODELS]) : [],
    ratePerMinute: positiveInt(env.RATE_LIMIT_PER_MINUTE, 30),
    dailyCap: positiveInt(env.DAILY_REQUEST_CAP, 5000),
    clientToken: nonEmpty(env.CLIENT_TOKEN),
    policyDir: env.POLICY_DIR ? path.resolve(env.POLICY_DIR) : DEFAULT_POLICY_DIR,
    classifyTimeoutMs: positiveInt(env.CLASSIFY_TIMEOUT_MS, 8000)
  };
}
