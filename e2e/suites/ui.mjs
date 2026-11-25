// Browser chrome UI: omnibox dropdown above page content, tab layout.
import { launchApp, sleep, startServer } from '../harness.mjs';

export default async function ui(results) {
  const server = await startServer();
  const ctx = await launchApp('ui');
  const { api, page } = ctx;
  const viewAttached = () => ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBrowserView() !== null);
  try {
    await api((url) => window.studyNest.navigate(url), server.allowed('/article'));
    await ctx.waitFor(async () => (await ctx.contentUrl()).includes('/article'));

    await page.click('.address-form input');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('machine learning', { delay: 20 });
    await page.waitForSelector('.omnibox-panel');
    await sleep(600);
    results.check('page view is hidden while the omnibox is open', (await viewAttached()) === false);
    results.check('a still image of the page is shown instead', (await page.locator('.page-snapshot').count()) === 1);
    const panel = await page.locator('.omnibox-panel').boundingBox();
    const form = await page.locator('.address-form').boundingBox();
    results.check('dropdown is anchored under the address bar',
      panel && form && Math.abs(panel.x - form.x) < 2 && panel.y >= form.y + form.height, JSON.stringify({ panel, form }));
    await ctx.shot('omnibox');

    await page.keyboard.press('Escape');
    await page.locator('.address-form input').blur();
    await sleep(500);
    results.check('page view returns when the omnibox closes', (await viewAttached()) === true);
    results.check('still image is removed', (await page.locator('.page-snapshot').count()) === 0);

    await api((url) => window.studyNest.newTab(url), server.allowed('/a-very-long-title-that-should-be-truncated-with-an-ellipsis-in-the-tab-strip'));
    await sleep(800);
    const widths = await page.locator('.tab').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width));
    results.check('tabs keep a bounded width', widths.every((width) => width <= 221), widths.join(','));
    const overflow = await page.locator('.tabs-row').evaluate((row) => row.scrollHeight > row.clientHeight);
    results.check('tab strip has no vertical overflow', overflow === false);
    await ctx.shot('tabs');
    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
  } finally {
    await ctx.close();
    await server.close();
  }
}
