// Phase 5 security: sandbox + CSP, IPC sender checks, site permission prompts, error pages.
import { launchApp, sleep, startServer } from '../harness.mjs';

/** Replaces the native permission dialog with a scripted answer and records the prompts. */
async function scriptPermissionDialog(ctx, response) {
  await ctx.app.evaluate(({ dialog }, answer) => {
    globalThis.__prompts = globalThis.__prompts ?? [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__prompts.push(options.message);
      return { response: answer, checkboxChecked: true };
    };
  }, response);
}

const prompts = (ctx) => ctx.app.evaluate(() => globalThis.__prompts ?? []);
const inPage = (ctx, code) =>
  ctx.app.evaluate(({ BrowserWindow }, source) => BrowserWindow.getAllWindows()[0].getBrowserView().webContents.executeJavaScript(source, true), code);

export default async function security(results) {
  const server = await startServer();
  const ctx = await launchApp('security');
  const { api, page } = ctx;
  try {
    // Browser chrome hardening.
    const chrome = await page.evaluate(() => ({
      process: typeof window.process,
      require: typeof window.require,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
    }));
    results.check('browser chrome runs sandboxed (no Node globals)', chrome.process === 'undefined' && chrome.require === 'undefined', JSON.stringify(chrome));
    results.check('browser chrome has a Content-Security-Policy', chrome.csp.includes("script-src 'self'") && chrome.csp.includes("default-src 'none'"));

    const sandboxed = await ctx.app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    });
    results.check('chrome web preferences are locked down', sandboxed.sandbox === true && sandboxed.contextIsolation === true && sandboxed.nodeIntegration === false, JSON.stringify(sandboxed));

    // An untrusted window that loads the same preload must be refused by main.
    const untrusted = await ctx.app.evaluate(async ({ app, BrowserWindow }) => {
      const separator = process.platform === 'win32' ? String.fromCharCode(92) : '/';
      const preload = [app.getAppPath(), 'dist-electron', 'preload', 'index.cjs'].join(separator);
      const intruder = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } });
      await intruder.loadURL('data:text/html,<p>intruder</p>');
      const outcome = await intruder.webContents.executeJavaScript(
        'window.studyNest ? window.studyNest.getState().then(() => "allowed", (error) => "rejected: " + error.message) : "no-bridge"',
        true
      );
      intruder.destroy();
      return outcome;
    });
    results.check('IPC from an untrusted window is rejected', String(untrusted).startsWith('rejected'), untrusted);

    // Site permissions.
    await api((url) => window.studyNest.navigate(url), server.allowed('/maps'));
    await ctx.waitFor(async () => (await ctx.contentUrl()).includes('/maps'));

    await scriptPermissionDialog(ctx, 1); // Block
    const geo = await inPage(ctx, `new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('granted'), (error) => resolve('denied:' + error.code), { timeout: 5000 }))`);
    results.check('geolocation prompts the user', (await prompts(ctx)).some((message) => message.includes('know your location')), JSON.stringify(await prompts(ctx)));
    results.check('blocking geolocation denies the page', String(geo).startsWith('denied:1'), geo);

    await scriptPermissionDialog(ctx, 0); // Allow
    const notification = await inPage(ctx, 'Notification.requestPermission()');
    results.check('allowing notifications grants them', notification === 'granted', notification);

    const before = (await prompts(ctx)).length;
    const again = await inPage(ctx, 'Notification.requestPermission()');
    results.check('remembered choice is reused without a prompt', again === 'granted' && (await prompts(ctx)).length === before);

    const saved = await api(() => window.studyNest.getSitePermissions());
    results.check('decisions are listed for Settings',
      saved.some((entry) => entry.key === 'geolocation' && entry.decision === 'deny') && saved.some((entry) => entry.key === 'notifications' && entry.decision === 'allow'),
      JSON.stringify(saved));

    const midi = await inPage(ctx, `navigator.requestMIDIAccess({ sysex: true }).then(() => 'granted', () => 'denied')`);
    results.check('device-level access (MIDI sysex) is denied without a prompt', midi === 'denied' && (await prompts(ctx)).length === before, midi);

    const cleared = await api(() => window.studyNest.resetSitePermissions());
    results.check('Reset all clears saved decisions', cleared.length === 0);

    await ctx.openInternalPage('studynest://settings#permissions', '[aria-label="Site permissions"]');
    await sleep(400);
    await ctx.shot('settings-permissions');
    await api((tabId) => window.studyNest.closeTab(tabId), (await ctx.activeTab()).id);

    // Error pages.
    // A port that was just freed: connection refused (port 1 would hit Chromium's unsafe-port block instead).
    const closed = await startServer();
    const closedUrl = closed.allowed('/unreachable');
    await closed.close();
    await api((url) => window.studyNest.navigate(url), closedUrl);
    const errorShown = await ctx.waitFor(async () => (await ctx.contentUrl()).includes('studynest-error='));
    await sleep(500);
    const tab = await ctx.activeTab();
    results.check('unreachable site shows an error page', Boolean(errorShown));
    results.check('error page keeps the real URL and is not treated as blocked', tab.url === closedUrl && tab.blocked === null, JSON.stringify({ url: tab.url, blocked: tab.blocked }));
    results.check('error page title explains the failure', /reach/i.test(tab.title), tab.title);
    await ctx.shot('error-page');

    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
  } finally {
    await ctx.close();
    await server.close();
  }
}
