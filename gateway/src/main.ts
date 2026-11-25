import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeClassifier } from './claude-classifier.js';
import { GatewayConfig, readConfig } from './config.js';
import { createGeminiClassifier } from './gemini-classifier.js';
import { loadPolicy } from './policy.js';
import { createGatewayServer } from './server.js';

/** Loads gateway/.env if present (never overrides real environment variables). */
function loadDotEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(here, '../../../.env')]) {
    if (!fs.existsSync(candidate)) continue;
    for (const line of fs.readFileSync(candidate, 'utf-8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && process.env[match[1]!] === undefined) {
        process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
      }
    }
    return;
  }
}

loadDotEnv();
const config = readConfig();
const log = (message: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...(data ?? {}) }));

function createClassifier({ provider, apiKey, model, fallbackModels }: GatewayConfig) {
  if (!apiKey) return null;
  if (provider === 'gemini') {
    return createGeminiClassifier({ apiKey, models: [...new Set([model, ...fallbackModels])] });
  }
  return createClaudeClassifier({ apiKey, model });
}

if (!config.apiKey) {
  const keyName = config.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
  log(`${keyName} is not set: /v1/classify will return 503 and the desktop app will use its offline rules.`);
}

const server = createGatewayServer({
  config,
  classifier: createClassifier(config),
  loadPolicy: () => loadPolicy(config.policyDir),
  log
});

server.listen(config.port, config.host, () => {
  log('StudyNest gateway listening', { host: config.host, port: config.port, provider: config.provider, model: config.model, fallbackModels: config.fallbackModels, policyDir: config.policyDir });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
