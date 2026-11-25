// Packaged build: the unpacked app electron-builder produced (what the installer installs).
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, REPO_DIR, startServer } from '../harness.mjs';

function findPackagedExe() {
  const version = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'package.json'), 'utf-8')).version;
  const exe = path.join(REPO_DIR, 'release', version, 'win-unpacked', 'StudyNest.exe');
  return fs.existsSync(exe) ? { exe, version } : { exe: null, version };
}

export default async function packaged(results) {
  const { exe, version } = findPackagedExe();
  results.check('packaged executable exists (run `npm run dist:win`)', Boolean(exe), exe ?? `release/${version}/win-unpacked/StudyNest.exe`);
  if (!exe) return;

  // Without the test override, the installed app must use the policy files shipped in resources/.
  const bundled = await launchApp('packaged-bundled', { executable: exe, env: { STUDYNEST_POLICY_DIR: '' } });
  try {
    const policy = (await bundled.api(() => window.studyNest.getStudyState())).policy;
    results.check('installed app uses the bundled backend rules', policy.source === 'bundled' && policy.blockRules > 10 && policy.allowRules > 10, JSON.stringify(policy));
  } finally {
    await bundled.close();
  }

  const server = await startServer();
  const ctx = await launchApp('packaged', { executable: exe });
  const { api, page } = ctx;
  try {
    const info = await ctx.app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), name: app.getName(), path: app.getAppPath() }));
    results.check('runs as the packaged app', info.packaged && info.version === version && info.name === 'StudyNest' && info.path.endsWith('app.asar'), JSON.stringify(info));

    const chrome = await page.evaluate(() => ({
      csp: Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]')),
      process: typeof window.process
    }));
    results.check('chrome is sandboxed with a CSP', chrome.csp && chrome.process === 'undefined', JSON.stringify(chrome));

    // Externalized runtime dependencies must resolve from inside app.asar.
    const ai = await api(() => window.studyNest.getAiState());
    results.check('classification client is configured with the gateway', typeof ai.gateway.url === 'string' && ai.gateway.url.length > 0, JSON.stringify(ai.gateway));

    const update = await api(() => window.studyNest.getUpdateState());
    results.check('auto-update is enabled in the installed build', update.status !== 'disabled' && update.currentVersion === version, JSON.stringify(update));
    const checked = await api(() => window.studyNest.checkForUpdates());
    results.check('update check runs and reports a clear result', ['up-to-date', 'error', 'downloading', 'downloaded', 'checking'].includes(checked.status) && (checked.status !== 'error' || Boolean(checked.message)), JSON.stringify(checked));

    // Rules come from the fixture policy folder (STUDYNEST_POLICY_DIR); localhost is blocked.
    await api(() => window.studyNest.startStudySession(null));
    await api((url) => window.studyNest.navigate(url), server.blocked('/x'));
    results.check('Study Mode blocks in the packaged app', Boolean(await ctx.waitFor(async () => (await ctx.contentUrl()).startsWith('data:text/html'))));
    await api(() => window.studyNest.stopStudySession());

    await ctx.openInternalPage('studynest://settings#updates', '[aria-label="Updates"]');
    const overflow = await page.locator('.internal-page').evaluate((panel) => panel.scrollWidth - panel.clientWidth);
    results.check('settings page content fits its width', overflow <= 1, `overflow ${overflow}px`);
    await page.evaluate(() => document.querySelector('[aria-label="Updates"]').scrollIntoView());
    await ctx.shot('settings-updates');
    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
  } finally {
    await ctx.close();
    await server.close();
  }
}
