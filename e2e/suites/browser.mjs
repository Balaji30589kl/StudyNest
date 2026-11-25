// Phase 5 browser basics: keyboard shortcuts, window state, downloads.
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, OUTPUT_DIR, sleep, startServer } from '../harness.mjs';

/** Sends a real keyboard event to the focused web contents (page or chrome). */
async function press(ctx, target, keyCode, modifiers = []) {
  await ctx.app.evaluate(({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows()[0];
    const contents = args.target === 'page' ? win.getBrowserView().webContents : win.webContents;
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: args.keyCode, modifiers: args.modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode: args.keyCode, modifiers: args.modifiers });
  }, { target, keyCode, modifiers });
  await sleep(500);
}

export default async function browser(results) {
  const downloadDir = path.join(OUTPUT_DIR, 'browser', 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const server = await startServer({
    '/file.txt': (_req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-disposition', 'attachment; filename="notes.txt"');
      res.end('study notes\n'.repeat(1000));
    }
  });
  const profile = path.join(OUTPUT_DIR, 'browser', 'profile');
  let ctx = await launchApp('browser', { userData: profile });
  try {
    const { api, page } = ctx;
    await api((url) => window.studyNest.navigate(url), server.allowed('/one'));
    await ctx.waitFor(async () => (await ctx.contentUrl()).includes('/one'));
    const tabCount = async () => (await api(() => window.studyNest.getState())).tabs.length;

    // Shortcuts pressed while focus is inside the web page.
    await press(ctx, 'page', 't', ['control']);
    results.check('Ctrl+T opens a new tab', (await tabCount()) === 2);
    results.check('new tab focuses the address bar', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Address and search bar'));
    await page.keyboard.press('Escape');
    await page.locator('.address-form input').blur();

    await press(ctx, 'page', 'w', ['control']);
    results.check('Ctrl+W closes the active tab', (await tabCount()) === 1);

    await api((url) => window.studyNest.newTab(url), server.allowed('/two'));
    await sleep(800);
    await press(ctx, 'page', 'w', ['control']);
    await press(ctx, 'page', 't', ['control', 'shift']);
    const reopened = await ctx.activeTab();
    results.check('Ctrl+Shift+T reopens the closed tab', reopened?.url.includes('/two'), reopened?.url);

    const before = (await ctx.activeTab()).id;
    await press(ctx, 'page', 'Tab', ['control']);
    results.check('Ctrl+Tab switches tabs', (await ctx.activeTab()).id !== before);

    await press(ctx, 'page', 'l', ['control']);
    results.check('Ctrl+L focuses the address bar from inside a page',
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Address and search bar'));
    await page.keyboard.press('Escape');
    await page.locator('.address-form input').blur();
    await sleep(300);

    await press(ctx, 'page', '=', ['control']);
    const zoom = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBrowserView().webContents.getZoomLevel());
    results.check('Ctrl+= zooms the page', zoom > 0, zoom);
    await press(ctx, 'page', '0', ['control']);

    // Downloads: save path is preset so no native dialog blocks the test.
    await ctx.app.evaluate(({ session }, dir) => {
      session.defaultSession.on('will-download', (_event, item) => item.setSavePath(`${dir}\\${item.getFilename()}`));
    }, downloadDir);
    await api((url) => window.studyNest.navigate(url), server.allowed('/file.txt'));
    const finished = await ctx.waitFor(async () => {
      const list = await api(() => window.studyNest.getDownloads());
      return list.find((entry) => entry.state === 'completed');
    }, 10_000);
    results.check('download completes and is listed', Boolean(finished) && finished.filename === 'notes.txt', JSON.stringify(finished));
    results.check('downloaded file exists', fs.existsSync(path.join(downloadDir, 'notes.txt')));
    results.check('downloads panel opens automatically', Boolean(await page.waitForSelector('.download-list', { timeout: 3000 }).catch(() => null)));
    await ctx.shot('downloads');

    // Window state: resize, relaunch, expect the same size.
    await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 40, width: 1150, height: 740 }));
    await sleep(600);
    // Compare against what the OS actually applied (it may clamp to the work area).
    const savedBounds = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    await ctx.close();
    ctx = await launchApp('browser-relaunch', { userData: profile });
    await sleep(500);
    const bounds = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    // Allow a few pixels: fractional display scaling (e.g. 125%) snaps sizes to whole physical pixels.
    const close = ['x', 'y', 'width', 'height'].every((key) => Math.abs(bounds[key] - savedBounds[key]) <= 4);
    results.check('window size and position are restored', close, `${JSON.stringify(savedBounds)} -> ${JSON.stringify(bounds)}`);
    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
  } finally {
    await ctx.close();
    await server.close();
  }
}
