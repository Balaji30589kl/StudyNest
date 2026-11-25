import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../app-config.js';
import { loadPolicyDir, PolicyService } from './policy-service.js';

const REPO_POLICY = path.resolve(__dirname, '../../../policy');
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studynest-policy-'));
  tempDirs.push(dir);
  return dir;
}

describe('policy files', () => {
  it('ships valid block and allow lists', () => {
    const policy = loadPolicyDir(REPO_POLICY)!;
    expect(policy.block).toContain('youtube.com/shorts');
    // Searches are judged by their query, so a comedy search is not a way around Study Mode.
    expect(policy.allow.some((rule) => rule.startsWith('youtube.com'))).toBe(false);
    expect(policy.classification.perPageHosts).toContain('youtube.com');
    expect(policy.classification.distractingCategories).toEqual(expect.arrayContaining(['entertainment', 'social']));
  });
});

describe('PolicyService', () => {
  const gatewayPolicy = { version: 'v2', block: ['tiktok.com'], allow: ['wikipedia.org'], classification: { enabled: true, minConfidence: 0.7, distractingCategories: ['gaming'], perPageHosts: ['youtube.com'] } };

  it('starts from the bundled files, then replaces them with the gateway copy and caches it', async () => {
    const userData = tempDir();
    const fetchImpl = vi.fn(async () => Response.json(gatewayPolicy)) as unknown as typeof fetch;
    const service = new PolicyService({ bundledDir: REPO_POLICY, cacheFile: path.join(userData, 'policy-cache.json'), getGatewayUrl: () => 'http://gw.test', fetchImpl });
    expect(service.getSnapshot().source).toBe('bundled');

    const changed = vi.fn();
    service.onChange(changed);
    expect(await service.refresh()).toBe(true);
    expect(service.getPolicy().block).toEqual(['tiktok.com']);
    expect(service.getSnapshot()).toMatchObject({ source: 'gateway', version: 'v2', blockRules: 1, lastError: null });
    expect(changed).toHaveBeenCalled();

    // A restart without network uses the cached gateway copy.
    const restarted = new PolicyService({ bundledDir: REPO_POLICY, cacheFile: path.join(userData, 'policy-cache.json'), getGatewayUrl: () => 'http://gw.test' });
    expect(restarted.getSnapshot()).toMatchObject({ source: 'gateway-cache', version: 'v2' });
    expect(restarted.getPolicy().block).toEqual(['tiktok.com']);
  });

  it('keeps the current rules when the gateway is unreachable or returns junk', async () => {
    const userData = tempDir();
    const down = new PolicyService({
      bundledDir: REPO_POLICY,
      cacheFile: path.join(userData, 'c.json'),
      getGatewayUrl: () => 'http://gw.test',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch
    });
    const before = down.getPolicy();
    expect(await down.refresh()).toBe(false);
    expect(down.getPolicy()).toBe(before);
    expect(down.getSnapshot().lastError).toBe('ECONNREFUSED');

    const junk = new PolicyService({
      bundledDir: REPO_POLICY,
      cacheFile: path.join(userData, 'd.json'),
      getGatewayUrl: () => 'http://gw.test',
      fetchImpl: (async () => Response.json({ block: [], allow: [] })) as unknown as typeof fetch
    });
    expect(await junk.refresh()).toBe(false);
    expect(junk.getSnapshot().source).toBe('bundled');
  });

  it('uses only the override folder in development and tests', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'blocklist.json'), JSON.stringify({ rules: ['localhost'] }));
    fs.writeFileSync(path.join(dir, 'allowlist.json'), JSON.stringify({ rules: [] }));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new PolicyService({ bundledDir: REPO_POLICY, cacheFile: path.join(dir, 'c.json'), overrideDir: dir, getGatewayUrl: () => 'http://gw.test', fetchImpl });
    expect(service.getSnapshot().source).toBe('override');
    expect(service.getPolicy().block).toEqual(['localhost']);
    expect(await service.refresh()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to built-in rules if the bundled files are missing', () => {
    const service = new PolicyService({ bundledDir: tempDir(), cacheFile: path.join(tempDir(), 'c.json'), getGatewayUrl: () => 'http://gw.test' });
    expect(service.getSnapshot().source).toBe('built-in');
    expect(service.getPolicy().block.length).toBeGreaterThan(0);
  });
});

describe('loadAppConfig', () => {
  it('reads the shipped config and lets environment variables override it', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ gatewayUrl: 'https://gw.example', policyRefreshHours: 2 }));
    expect(loadAppConfig(dir, {})).toEqual({ gatewayUrl: 'https://gw.example', gatewayToken: null, policyRefreshHours: 2 });
    expect(loadAppConfig(dir, { STUDYNEST_GATEWAY_URL: 'http://127.0.0.1:9', STUDYNEST_GATEWAY_TOKEN: 't' })).toMatchObject({ gatewayUrl: 'http://127.0.0.1:9', gatewayToken: 't' });
    expect(loadAppConfig(tempDir(), {}).gatewayUrl).toBe('http://127.0.0.1:8787');
  });
});
