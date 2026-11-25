// AI checks before rendering, through the real gateway server (Claude call stubbed).
// Fixture: 127.0.0.1 is judged per page, so each "video" gets its own verdict.
import { launchApp, sleep, startGateway, startServer } from '../harness.mjs';

const video = (title, genre, extra = '') => `<!doctype html><html lang="en"><head><title>${title} - VideoSite</title>
<meta property="og:title" content="${title}"><meta name="description" content="${title}. Watch now.">
<meta property="og:type" content="video.other"><meta itemprop="genre" content="${genre}"></head>
<body><main><h1>${title}</h1>${extra}</main></body></html>`;

export default async function ai(results) {
  const server = await startServer({
    '/watch': (req, res) => {
      const id = new URL(req.url, 'http://x').searchParams.get('v');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (id === 'lecture') {
        // A "next video" button that changes the URL in-page, like YouTube does.
        res.end(video('Lecture 4: Dynamic Programming', 'Education', `<button id="next" onclick="history.pushState({}, '', '/watch?v=prank2')">Next</button>`));
      } else if (id === 'prank' || id === 'prank2') {
        res.end(video('Funny prank compilation #shorts', 'Comedy'));
      } else if (id === 'offline') {
        res.end(video('Funny meme reaction', 'Comedy'));
      } else {
        res.end(video('Untitled clip', ''));
      }
    }
  });
  const gateway = await startGateway();
  const ctx = await launchApp('ai', { env: { STUDYNEST_GATEWAY_URL: gateway.url } });
  const { api, page } = ctx;
  const lectureUrl = server.allowed('/watch?v=lecture');
  const prankUrl = server.allowed('/watch?v=prank');
  try {
    await api(() => window.studyNest.startStudySession(null));

    // Educational video: checked first, then rendered.
    const hitsBefore = server.hits('/watch');
    await api((url) => window.studyNest.navigate(url), lectureUrl);
    const sawChecking = await ctx.waitFor(async () => (await ctx.activeTab()).checking || (await ctx.contentUrl()).includes('studynest-checking='), 3000);
    results.check('unlisted page shows "Checking page…" first', Boolean(sawChecking));
    results.check('educational video opens after the check', Boolean(await ctx.waitFor(async () => (await ctx.contentUrl()) === lectureUrl, 10000)));
    results.check('page was fetched once for metadata, then once to render', server.hits('/watch') - hitsBefore === 2, `hits=${server.hits('/watch') - hitsBefore}`);
    await sleep(300);
    await ctx.shot('lecture');

    // Entertainment video on the same site: blocked, never rendered.
    const prankHits = server.hits('/watch');
    await api((url) => window.studyNest.navigate(url), prankUrl);
    const blocked = await ctx.waitFor(async () => (await ctx.activeTab()).blocked?.reason === 'classified', 10000);
    const tab = await ctx.activeTab();
    results.check('entertainment video on the same site is blocked', Boolean(blocked) && tab.blocked.classification?.category === 'entertainment', JSON.stringify(tab.blocked));
    results.check('blocked video was only fetched for metadata, never rendered', server.hits('/watch') - prankHits === 1, `hits=${server.hits('/watch') - prankHits}`);
    await sleep(300);
    await ctx.shot('blocked-video');

    // Cached verdicts: a repeat visit is decided instantly with no new gateway call.
    const callsBefore = gateway.calls.length;
    const repeatHits = server.hits('/watch');
    await api((url) => window.studyNest.navigate(url), `${prankUrl}&t=30`);
    await ctx.waitFor(async () => (await ctx.activeTab()).blocked !== null, 5000);
    results.check('repeat visit uses the cached verdict (no gateway call, no request)', gateway.calls.length === callsBefore && server.hits('/watch') === repeatHits);

    // In-page navigation (YouTube-style "next video").
    await api((url) => window.studyNest.navigate(url), lectureUrl);
    await ctx.waitFor(async () => (await ctx.contentUrl()) === lectureUrl, 5000);
    await sleep(300);
    await ctx.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBrowserView().webContents.executeJavaScript("document.getElementById('next').click()", true)
    );
    results.check('switching videos inside the page is checked and blocked',
      Boolean(await ctx.waitFor(async () => (await ctx.activeTab()).blocked?.url?.includes('prank2'), 10000)));

    // What the gateway received: structured metadata, never cookies or full HTML.
    const sent = gateway.calls.find((metadata) => metadata.key.includes('lecture'));
    results.check('gateway received page metadata (title, genre, per-video key)',
      sent && sent.title.startsWith('Lecture 4') && sent.genre === 'Education' && sent.key === '127.0.0.1/watch?v=lecture', JSON.stringify(sent));

    const stats = (await api(() => window.studyNest.getStudyState())).stats;
    results.check('stats record AI checks, blocks and categories',
      stats.aiChecks >= 2 && stats.blockedByAi >= 1 && stats.aiAllowed >= 1 && stats.categoryCounts.entertainment >= 1 && stats.categoryCounts.study >= 1,
      JSON.stringify(stats));

    // Gateway goes down: offline rules take over.
    await gateway.close();
    await api((url) => window.studyNest.navigate(url), server.allowed('/watch?v=offline'));
    const offline = await ctx.waitFor(async () => (await ctx.activeTab()).blocked?.classification?.providerId === 'rule-based', 10000);
    results.check('when the gateway is down, offline rules still decide', Boolean(offline), JSON.stringify((await ctx.activeTab()).blocked));
    const aiState = await api(() => window.studyNest.getAiState());
    results.check('AI status reports the gateway offline', aiState.gateway.status === 'offline', JSON.stringify(aiState.gateway));

    await api(() => window.studyNest.stopStudySession());
    await page.click('button:has-text("Insights")');
    await page.waitForSelector('[aria-label="Distractions"]');
    results.check('insights show AI and category breakdowns', (await page.locator('.category-bars li').count()) >= 2);
    await sleep(400);
    await ctx.shot('insights');
    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
  } finally {
    await ctx.close();
    await gateway.close().catch(() => undefined);
    await server.close();
  }
}
