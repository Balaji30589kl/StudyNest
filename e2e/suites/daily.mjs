// Phase 7 everyday browsing: new tab page, history, bookmarks, find in page,
// tab management, settings and session restore, in the built app.
import path from 'node:path';
import { launchApp, OUTPUT_DIR, sleep, startServer } from '../harness.mjs';

const article = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

export default async function daily(results) {
  const server = await startServer({
    '/notes': (_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(article('Eigenvalue notes', 'An eigenvalue scales its eigenvector. Every eigenvalue has an eigenvector. eigenvalue eigenvalue'));
    },
    '/allowed/lecture': (_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><title>Lecture page</title></head><body>
        <div id="article"><h1>Lecture 3: Recursion</h1><p>Content stays visible.</p></div>
        <aside id="recommendations"><a href="/funny">Funny prank compilation</a></aside>
        <div class="hover-preview">autoplaying preview</div>
        <img id="animated" src="/an_webp/clip.webp?v=${Date.now()}" alt=""></body></html>`);
    },
    '/an_webp/clip.webp': (_req, res) => {
      res.setHeader('content-type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    },
    '/second': (_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(article('Second page', 'Nothing to see.'));
    }
  });
  const profile = path.join(OUTPUT_DIR, 'daily', 'profile');
  let ctx = await launchApp('daily', { userData: profile });
  const notesUrl = server.allowed('/notes');
  const secondUrl = server.allowed('/second');
  try {
    const { api, page } = ctx;

    // New tab page is drawn by the browser itself.
    results.check('starts on the built-in new tab page', (await ctx.activeTab()).url === 'studynest://newtab');
    results.check('new tab page shows search and Study Mode card', (await page.locator('.newtab-search-box input').count()) === 1 && (await page.locator('.newtab-focus').count()) === 1);
    await ctx.shot('newtab');

    // Searching from the new tab page navigates this tab.
    await page.fill('.newtab-search-box input', notesUrl);
    await page.keyboard.press('Enter');
    await ctx.waitFor(async () => (await ctx.contentUrl()) === notesUrl, 10_000);
    await ctx.waitFor(async () => (await ctx.activeTab()).title === 'Eigenvalue notes', 5000);
    results.check('typing an address on the new tab page opens it', (await ctx.contentUrl()) === notesUrl);
    results.check('Back is available after leaving the new tab page', (await ctx.activeTab()).canGoBack === true);
    await api(() => window.studyNest.goBack());
    await sleep(300);
    results.check('Back returns to the new tab page, not a blank page', (await ctx.activeTab()).url === 'studynest://newtab' && (await page.locator('.newtab').count()) === 1);
    results.check('Forward is then available', (await ctx.activeTab()).canGoForward === true);
    await api(() => window.studyNest.goForward());
    await sleep(300);
    results.check('Forward shows the page again without reloading it', (await ctx.activeTab()).url === notesUrl && (await ctx.contentUrl()) === notesUrl);

    // History records the visit with its title.
    await sleep(600);
    const history = await api(() => window.studyNest.queryHistory({ text: 'eigenvalue' }));
    results.check('history records the visit and its title', history.some((entry) => entry.url === notesUrl && entry.title === 'Eigenvalue notes'), JSON.stringify(history));
    const suggestions = await api((text) => window.studyNest.suggestHistory(text), 'eigen');
    results.check('address-bar history suggestions find it by title', suggestions[0]?.url === notesUrl);

    // Bookmark with the star; it appears on the bookmarks bar.
    await page.click('.address-icon-button[aria-label="Bookmark this page"]');
    await page.waitForSelector('.bookmark-chip');
    results.check('the star bookmarks the page and the bar shows it', (await page.locator('.bookmark-chip').innerText()).includes('Eigenvalue notes'));
    results.check('a toast confirms the bookmark', Boolean(await page.waitForSelector('.toast', { timeout: 2000 }).catch(() => null)));

    // Find in page: Ctrl+F from the page, live match count.
    await ctx.command({ type: 'find' });
    await page.waitForSelector('.find-bar input');
    await page.keyboard.type('eigenvalue');
    const counted = await ctx.waitFor(async () => {
      const text = await page.locator('.find-count').innerText();
      return /of\s+[1-9]/.test(text) ? text : null;
    }, 5000);
    results.check('find in page counts matches', Boolean(counted), counted ?? (await page.locator('.find-count').innerText()));
    await page.keyboard.press('Enter');
    const stepped = await page.locator('.find-count').innerText();
    results.check('Enter moves to the next match', /^2 of /.test(stepped), stepped);
    await ctx.shot('find');
    await page.keyboard.press('Escape');
    results.check('Esc closes the find bar', (await page.locator('.find-bar').count()) === 0);

    // Built-in pages.
    await ctx.openInternalPage('studynest://history', '.list-row');
    results.check('History page lists the visit', (await page.locator('.list-row-title').allInnerTexts()).includes('Eigenvalue notes'));
    await ctx.shot('history');
    await api((url) => window.studyNest.navigate(url), 'studynest://bookmarks');
    await page.waitForSelector('.list-row');
    results.check('Bookmarks page lists the bookmark', (await page.locator('.list-row-title').allInnerTexts()).includes('Eigenvalue notes'));
    await api((url) => window.studyNest.navigate(url), 'studynest://settings');
    await page.waitForSelector('.settings-nav');
    await page.click('[role="radio"]:has-text("Dark")');
    await sleep(300);
    results.check('choosing the dark theme applies it to the browser', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
    await ctx.shot('settings-dark');
    await page.click('[role="radio"]:has-text("System")');
    const engine = await api(() => window.studyNest.updateSettings({ searchEngine: 'bing' }));
    await api((query) => window.studyNest.navigate(query), 'linear algebra');
    results.check('typed searches use the chosen search engine', (await ctx.activeTab()).url.startsWith('https://www.bing.com/search?q=linear%20algebra'), `${engine.searchEngine} ${(await ctx.activeTab()).url}`);
    await api((url) => window.studyNest.navigate(url), secondUrl);
    await ctx.waitFor(async () => (await ctx.contentUrl()) === secondUrl, 10_000);

    // Focus view: distracting parts of an allowed page are hidden during Study Mode only.
    const lectureUrl = server.allowed('/allowed/lecture');
    await api((url) => window.studyNest.navigate(url), lectureUrl);
    await ctx.waitFor(async () => (await ctx.contentUrl()) === lectureUrl, 10_000);
    await sleep(500);
    const inPage = (js) => ctx.app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].getBrowserView().webContents.executeJavaScript(code, true), js);
    const layout = () =>
      inPage(`JSON.stringify({
        recommendations: getComputedStyle(document.getElementById('recommendations')).display,
        preview: getComputedStyle(document.querySelector('.hover-preview')).display,
        article: getComputedStyle(document.getElementById('article')).display,
        note: getComputedStyle(document.getElementById('article'), '::before').content
      })`).then(JSON.parse);
    let view = await layout();
    results.check('without Study Mode, pages are untouched', view.recommendations !== 'none' && view.preview !== 'none' && view.note === 'none', JSON.stringify(view));
    await api(() => window.studyNest.startStudySession(null));
    view = await ctx.waitFor(async () => {
      const current = await layout();
      return current.recommendations === 'none' ? current : null;
    }, 5000);
    results.check('starting Study Mode hides recommendations and hover previews on an open page', view?.recommendations === 'none' && view?.preview === 'none', JSON.stringify(view));
    results.check('study content stays visible, with a focus notice', view?.article !== 'none' && String(view?.note).includes('Focus view is on'), JSON.stringify(view));
    await ctx.shot('focus-view');
    await api(() => window.studyNest.refresh());
    await ctx.waitFor(async () => (await ctx.activeTab()).isLoading === false, 5000);
    await sleep(300);
    view = await layout();
    results.check('focus view is applied again after a reload', view.recommendations === 'none', JSON.stringify(view));
    const animated = await inPage(`JSON.stringify({ display: getComputedStyle(document.getElementById('animated')).display, loaded: document.getElementById('animated').naturalWidth > 0 })`).then(JSON.parse);
    results.check('animated hover thumbnails are hidden and never downloaded during Study Mode', animated.display === 'none' && animated.loaded === false, JSON.stringify(animated));
    await api(() => window.studyNest.stopStudySession());
    view = await ctx.waitFor(async () => {
      const current = await layout();
      return current.recommendations !== 'none' ? current : null;
    }, 5000);
    results.check('ending Study Mode restores the page', Boolean(view) && view.preview !== 'none' && view.note === 'none', JSON.stringify(view));
    await api((url) => window.studyNest.navigate(url), secondUrl);
    await ctx.waitFor(async () => (await ctx.contentUrl()) === secondUrl, 10_000);

    // Tab management: pin and reorder.
    let state = await api(() => window.studyNest.getState());
    const last = state.tabs.at(-1);
    await api((tabId) => window.studyNest.tabAction({ type: 'pin', tabId }), last.id);
    state = await api(() => window.studyNest.getState());
    results.check('pinning moves a tab to the front', state.tabs[0].id === last.id && state.tabs[0].pinned);
    await api((tabId) => window.studyNest.tabAction({ type: 'move', tabId, index: 0 }), state.tabs[1].id);
    state = await api(() => window.studyNest.getState());
    results.check('unpinned tabs cannot move in front of pinned ones', state.tabs[0].id === last.id);
    results.check('pinned tabs show only their icon', (await page.locator('.tab.pinned .tab-title').count()) === 0);
    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
    const openTabs = state.tabs.map((tab) => tab.url);
    await ctx.close();

    // Session restore: the same tabs come back after a restart.
    ctx = await launchApp('daily', { userData: profile });
    await sleep(800);
    const restored = await ctx.api(() => window.studyNest.getState());
    results.check('tabs are restored after a restart', JSON.stringify(restored.tabs.map((tab) => tab.url)) === JSON.stringify(openTabs), JSON.stringify(restored.tabs.map((tab) => tab.url)));
    results.check('pinned state survives a restart', restored.tabs[0].pinned === true);
    const bookmarks = await ctx.api(() => window.studyNest.getBookmarks());
    results.check('bookmarks survive a restart', bookmarks.some((bookmark) => bookmark.url === notesUrl));
  } finally {
    await ctx.close();
    await server.close();
  }
}
