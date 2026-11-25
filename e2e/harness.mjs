// End-to-end harness: launches the built StudyNest app with Playwright's Electron
// driver, serves local test pages, and records pass/fail checks.
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Screenshots and test profiles; STUDYNEST_E2E_OUTPUT moves them (for example when a stuck test app still holds the default folder). */
export const OUTPUT_DIR = process.env.STUDYNEST_E2E_OUTPUT ? path.resolve(process.env.STUDYNEST_E2E_OUTPUT) : path.join(REPO_DIR, 'e2e-output');
export const FIXTURE_POLICY_DIR = path.join(REPO_DIR, 'e2e', 'fixtures', 'policy');
/** Nothing listens here: apps launched without a gateway use their offline rules. */
export const NO_GATEWAY_URL = 'http://127.0.0.1:9';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Playwright's Windows launcher passes arguments through a shell, which breaks
 * on paths with spaces. Point it at a space-free junction instead.
 */
function resolveAppDir() {
  if (process.platform !== 'win32' || !REPO_DIR.includes(' ')) {
    return REPO_DIR;
  }
  const junction = path.join(os.tmpdir(), 'studynest-e2e-app');
  try {
    if (fs.realpathSync(junction) === fs.realpathSync(REPO_DIR)) {
      return junction;
    }
    fs.rmSync(junction, { recursive: false, force: true });
  } catch {
    // Junction does not exist yet.
  }
  execFileSync('cmd', ['/c', 'mklink', '/J', junction, REPO_DIR], { stdio: 'ignore' });
  return junction;
}

const APP_DIR = resolveAppDir();

export function electronBinary() {
  return process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');
}

export class Results {
  constructor(suite) {
    this.suite = suite;
    this.items = [];
  }
  check(name, ok, detail = '') {
    this.items.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` (${String(detail).slice(0, Number(process.env.E2E_DETAIL_CHARS ?? 300))})` : ''}`);
  }
  get failed() {
    return this.items.filter((item) => !item.ok).length;
  }
}

/** Local web server. Every page is reachable as both 127.0.0.1 and localhost (two policy hosts). */
export async function startServer(routes = {}) {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    const route = routes[url.pathname];
    if (typeof route === 'function') {
      route(req, res);
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(route ?? `<!doctype html><html lang="en"><head><title>Test page ${url.pathname}</title></head><body><main><h1>Test page</h1><p>${url.pathname}</p></main></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    allowed: (p = '/') => `http://127.0.0.1:${port}${p}`,
    blocked: (p = '/') => `http://localhost:${port}${p}`,
    hits: (p) => hits.get(p) ?? 0,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/** Launches the dev build by default, or a packaged executable when `executable` is given. */
export async function launchApp(name, { userData, executable, env: extraEnv = {} } = {}) {
  const dir = path.join(OUTPUT_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const profile = userData ?? path.join(dir, 'profile');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
    // Tests use fixture rules and never reach a real gateway unless a suite starts one.
    STUDYNEST_POLICY_DIR: FIXTURE_POLICY_DIR,
    STUDYNEST_GATEWAY_URL: NO_GATEWAY_URL,
    // No ad-block list downloads during tests; the ad blocker has its own unit tests.
    STUDYNEST_ADBLOCK: 'off',
    ...extraEnv
  };
  const app = await electron.launch({
    executablePath: executable ?? electronBinary(),
    args: executable ? [`--user-data-dir=${profile}`] : [APP_DIR, `--user-data-dir=${profile}`],
    env,
    timeout: 45_000
  });

  const logs = [];
  app.process().stderr?.on('data', (data) => logs.push(String(data)));

  let page = null;
  for (let attempt = 0; attempt < 120 && !page; attempt += 1) {
    page = app.windows().find((window) => window.url().includes('index.html'));
    if (!page) await sleep(250);
  }
  if (!page) {
    throw new Error(`Browser chrome window did not open. Windows: ${app.windows().map((w) => w.url()).join(', ')}`);
  }
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.waitForSelector('.tabs-row .tab', { timeout: 30_000 });

  const api = (fn, arg) => page.evaluate(fn, arg);

  return {
    app,
    page,
    dir,
    profile,
    logs,
    pageErrors,
    api,
    /** Sends a browser command the way main does for shortcuts and native menu items (Playwright cannot click OS menus). */
    command: (detail) =>
      app.evaluate(({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0].webContents.send('browser:command', payload), detail),
    /** Opens a built-in page (studynest://...) in a new tab and waits for it to render. */
    async openInternalPage(url, selector) {
      await page.evaluate((target) => window.studyNest.newTab(target), url);
      if (selector) await page.waitForSelector(selector);
    },
    /** URL actually loaded in the active tab's web contents. */
    contentUrl: () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBrowserView()?.webContents.getURL() ?? ''),
    activeTab: async () => {
      const state = await page.evaluate(() => window.studyNest.getState());
      return state.tabs.find((tab) => tab.id === state.activeTabId);
    },
    async waitFor(fn, timeout = 10_000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const value = await fn();
        if (value) return value;
        await sleep(200);
      }
      return null;
    },
    async shot(file) {
      const data = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const view = win.getBrowserView();
        return {
          chrome: (await win.webContents.capturePage()).toPNG().toString('base64'),
          view: view ? (await view.webContents.capturePage()).toPNG().toString('base64') : null
        };
      });
      fs.writeFileSync(path.join(dir, `${file}.png`), Buffer.from(data.chrome, 'base64'));
      if (data.view) fs.writeFileSync(path.join(dir, `${file}-page.png`), Buffer.from(data.view, 'base64'));
    },
    async close() {
      await app.close().catch(() => undefined);
    }
  };
}

/**
 * Starts the real StudyNest gateway (compiled from gateway/) with a stub in
 * place of the Claude call, so tests exercise the actual HTTP service, limits
 * and caching without an API key. The stub judges pages by their title.
 */
export async function startGateway(judge = defaultJudge) {
  const gatewayDist = path.join(REPO_DIR, 'gateway', 'dist', 'gateway', 'src');
  if (!fs.existsSync(path.join(gatewayDist, 'server.js'))) {
    throw new Error('Gateway build not found. Run `npm run gateway:build` first.');
  }
  const { createGatewayServer } = await import(pathToFileURL(path.join(gatewayDist, 'server.js')).href);
  const { readConfig } = await import(pathToFileURL(path.join(gatewayDist, 'config.js')).href);
  const { loadPolicy } = await import(pathToFileURL(path.join(gatewayDist, 'policy.js')).href);
  const calls = [];
  const server = createGatewayServer({
    config: readConfig({ POLICY_DIR: FIXTURE_POLICY_DIR, RATE_LIMIT_PER_MINUTE: '1000', DAILY_REQUEST_CAP: '10000' }),
    classifier: async (metadata) => {
      calls.push(metadata);
      return judge(metadata);
    },
    loadPolicy: () => loadPolicy(FIXTURE_POLICY_DIR)
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((resolve) => server.close(resolve)) };
}

function defaultJudge(metadata) {
  const text = `${metadata.title} ${metadata.genre}`.toLowerCase();
  if (/lecture|tutorial|education/.test(text)) return { category: 'study', confidence: 0.95, rationale: 'Lecture.' };
  if (/prank|funny|comedy|meme/.test(text)) return { category: 'entertainment', confidence: 0.95, rationale: 'Comedy.' };
  return { category: 'other', confidence: 0.5, rationale: 'Unclear.' };
}
