import fs from 'node:fs';
import path from 'node:path';

export type AppConfig = {
  gatewayUrl: string;
  gatewayToken: string | null;
  policyRefreshHours: number;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  gatewayUrl: 'http://127.0.0.1:8787',
  gatewayToken: null,
  policyRefreshHours: 6
};

/**
 * Reads config/app.json shipped with the app. Environment variables override
 * it (STUDYNEST_GATEWAY_URL, STUDYNEST_GATEWAY_TOKEN) for development and tests.
 */
export function loadAppConfig(configDir: string, env: Record<string, string | undefined> = process.env): AppConfig {
  let file: Record<string, unknown> = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(configDir, 'app.json'), 'utf-8')) as Record<string, unknown>;
  } catch {
    file = {};
  }
  const url = env.STUDYNEST_GATEWAY_URL?.trim() || (typeof file.gatewayUrl === 'string' ? file.gatewayUrl : DEFAULT_APP_CONFIG.gatewayUrl);
  const token = env.STUDYNEST_GATEWAY_TOKEN?.trim() || (typeof file.gatewayToken === 'string' && file.gatewayToken ? file.gatewayToken : null);
  const hours = typeof file.policyRefreshHours === 'number' && file.policyRefreshHours > 0 ? file.policyRefreshHours : DEFAULT_APP_CONFIG.policyRefreshHours;
  return { gatewayUrl: url, gatewayToken: token, policyRefreshHours: hours };
}
