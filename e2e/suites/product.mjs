// Phase 4: insights, two-device folder sync, diagnostics, crash recovery.
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, OUTPUT_DIR, sleep, startServer } from '../harness.mjs';

async function stubFolderDialog(ctx, folder) {
  await ctx.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, folder);
}

export default async function product(results) {
  const syncFolder = path.join(OUTPUT_DIR, 'product', 'sync-folder');
  const syncFile = path.join(syncFolder, 'studynest-sync.json');

  const a = await launchApp('product', { userData: path.join(OUTPUT_DIR, 'product', 'device-a') });
  let accountA;
  try {
    for (let index = 0; index < 2; index += 1) {
      await a.api(() => window.studyNest.startStudySession(15));
      await sleep(1000);
      await a.api(() => window.studyNest.stopStudySession());
    }
    const insights = await a.api(() => window.studyNest.getInsights());
    results.check('insights aggregate sessions', insights.totals.sessions === 2 && insights.daily.length === 14, JSON.stringify(insights.totals));

    await a.command({ type: 'open-panel', panel: 'insights' });
    await a.page.waitForSelector('.chart svg');
    const box = await a.page.locator('.chart-hit').last().boundingBox();
    await a.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    results.check('chart tooltip appears on hover', Boolean(await a.page.waitForSelector('.chart-tooltip', { timeout: 3000 }).catch(() => null)));
    await a.shot('insights');

    await a.api(() => window.studyNest.updateStudySettings({ defaultDurationMinutes: 50 }));
    await stubFolderDialog(a, syncFolder);
    accountA = await a.api(() => window.studyNest.chooseSyncFolder());
    results.check('device A syncs to the folder', accountA.sync.lastSyncAt && !accountA.sync.lastError && !accountA.sync.syncing, JSON.stringify(accountA.sync));
    results.check('sync file is written', fs.existsSync(syncFile));

    const diagnostics = await a.api(() => window.studyNest.getDiagnostics());
    results.check('diagnostics report version and a real log file', /^\d+\.\d+\.\d+/.test(diagnostics.appVersion) && fs.existsSync(diagnostics.logFile), diagnostics.logFile);

    // Crash a real web page (the new tab page is drawn by the browser window itself).
    const server = await startServer();
    await a.api((url) => window.studyNest.navigate(url), server.allowed('/page'));
    await a.waitFor(async () => (await a.contentUrl()).includes('/page'));
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBrowserView().webContents.forcefullyCrashRenderer());
    await sleep(2500);
    const alive = await a.app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].getBrowserView().webContents.isCrashed());
    results.check('crashed tab reloads and the crash is logged', alive && fs.readFileSync(diagnostics.logFile, 'utf-8').includes('tab renderer exited'));
    await server.close();
  } finally {
    await a.close();
  }

  const b = await launchApp('product-b', { userData: path.join(OUTPUT_DIR, 'product', 'device-b') });
  try {
    await stubFolderDialog(b, syncFolder);
    const accountB = await b.api(() => window.studyNest.chooseSyncFolder());
    const insightsB = await b.api(() => window.studyNest.getInsights());
    const studyB = await b.api(() => window.studyNest.getStudyState());
    results.check('device B receives the session history', insightsB.totals.sessions === 2, JSON.stringify(insightsB.totals));
    results.check('device B receives the settings', studyB.settings.defaultDurationMinutes === 50, JSON.stringify(studyB.settings));
    const document = JSON.parse(fs.readFileSync(syncFile, 'utf-8'));
    results.check('both devices registered; activity log never synced', Object.keys(document.devices).length === 2 && !('events' in document));
    results.check('devices have distinct identities', accountB.device.id !== accountA?.device.id);
  } finally {
    await b.close();
  }
}
