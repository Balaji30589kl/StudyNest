// Study Mode: on/off switch, timed sessions, list enforcement before render, restore, stats.
// Fixture rules: localhost and 127.0.0.1/shorts are blocked; 127.0.0.1/notes is allowed.
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, sleep, startServer } from '../harness.mjs';

export default async function study(results) {
  const server = await startServer();
  const ctx = await launchApp('study');
  const { api, page } = ctx;
  try {
    await api((url) => window.studyNest.navigate(url), server.blocked('/feed'));
    await ctx.waitFor(async () => (await ctx.contentUrl()).startsWith('http://localhost'));
    results.check('Study Mode off: block-listed site loads', (await ctx.contentUrl()).startsWith('http://localhost'));

    const policy = (await api(() => window.studyNest.getStudyState())).policy;
    results.check('rules come from the backend policy files', policy.source === 'override' && policy.blockRules === 2 && policy.allowRules === 2, JSON.stringify(policy));

    // Toolbar switch turns Study Mode on without a timer.
    await page.click('.study-switch');
    await ctx.waitFor(async () => (await api(() => window.studyNest.getStudyState())).session !== null);
    const session = (await api(() => window.studyNest.getStudyState())).session;
    results.check('toolbar switch turns Study Mode on (no timer)', session && session.endsAt === null, JSON.stringify(session));
    results.check('switch reflects the state', (await page.getAttribute('.study-switch', 'aria-checked')) === 'true');
    results.check('open block-listed tab is blocked when Study Mode turns on',
      Boolean(await ctx.waitFor(async () => (await ctx.contentUrl()).includes('studynest-blocked='))));

    const hitsBefore = server.hits('/again');
    await api((url) => window.studyNest.navigate(url), server.blocked('/again'));
    await sleep(800);
    const tab = await ctx.activeTab();
    results.check('blocked page never reaches the server', server.hits('/again') === hitsBefore, `hits=${server.hits('/again')}`);
    results.check('tab reports block details', tab.blocked?.host === 'localhost' && tab.blocked.reason === 'blocklisted', JSON.stringify(tab.blocked));
    results.check('address bar keeps the real URL', tab.url.includes('localhost'), tab.url);
    await ctx.shot('blocked');

    await api((url) => window.studyNest.navigate(url), server.blocked('/x').replace('localhost', '127.0.0.1').replace('/x', '/shorts/abc'));
    results.check('block-listed path (127.0.0.1/shorts) is blocked',
      Boolean(await ctx.waitFor(async () => (await ctx.activeTab()).blocked?.reason === 'blocklisted')));

    const notesHits = server.hits('/notes');
    await api((url) => window.studyNest.navigate(url), server.allowed('/notes'));
    await ctx.waitFor(async () => (await ctx.contentUrl()).endsWith('/notes'));
    results.check('allow-listed page opens directly, without an AI check', server.hits('/notes') === notesHits + 1 && !(await ctx.activeTab()).checking);

    // Turning Study Mode off restores blocked tabs.
    await api((url) => window.studyNest.navigate(url), server.blocked('/feed'));
    await ctx.waitFor(async () => (await ctx.contentUrl()).includes('studynest-blocked='));
    await page.click('.study-switch');
    results.check('turning Study Mode off restores the blocked tab',
      Boolean(await ctx.waitFor(async () => !(await ctx.activeTab()).blocked && (await ctx.contentUrl()).startsWith('http://localhost'))));

    // Timed session from the panel.
    await page.click('.study-button');
    await page.waitForSelector('.side-panel');
    await page.click('.study-card .chip-row .chip:nth-child(1)');
    await page.click('.study-card .secondary-button');
    await page.waitForSelector('.study-card.active');
    const timed = (await api(() => window.studyNest.getStudyState())).session;
    results.check('timed session starts from the panel', timed?.durationMinutes === 15 && timed.endsAt !== null, JSON.stringify(timed));
    results.check('toolbar shows the countdown', (await page.textContent('.study-button')).includes('Focus'));
    await sleep(300);
    await ctx.shot('panel');

    const stats = (await api(() => window.studyNest.getStudyState())).stats;
    results.check('session stats count list blocks', stats.blockedByList >= 1 && stats.blockedHosts.localhost >= 1, JSON.stringify(stats));

    await page.click('.study-card .danger-button');
    await sleep(800);
    const studyState = await api(() => window.studyNest.getStudyState());
    const types = studyState.recentEvents.map((event) => event.type);
    results.check('activity log records sessions and blocks', ['session-start', 'session-end', 'blocked'].every((type) => types.includes(type)), types.join(','));
    results.check('rules cannot be edited from the app', !(await page.locator('textarea').count()));
    results.check('study data is persisted', fs.existsSync(path.join(ctx.profile, 'study-data.json')));
    results.check('no renderer errors', ctx.pageErrors.length === 0, ctx.pageErrors.join(' | '));
  } finally {
    await ctx.close();
    await server.close();
  }
}
