# Phase 8: Focus View

Goal: remove the distractions that live *inside* allowed pages during Study Mode, without making studying harder.

## Principle

Hide only what reaches the student **without a click**: videos that start playing on hover, and ads. Everything a student has to click (recommendations, "Up next", comments, end screens) stays visible, because any page or video opened from them is checked by Study Mode first, and distracting ones are blocked. Hiding them would also hide the next lecture and make the student search again. (An earlier draft hid the recommendations sidebar, comments and Shorts shelves; it was narrowed after review for exactly this reason.)

## What happens during Study Mode

- **Hover previews off (YouTube):** thumbnails no longer start playing under the mouse. This covers both YouTube's hover video player (search and home) and the animated WebP thumbnails of the newer "Up next" cards: the clip is put back to the still image, its download is refused (`blockRequests: i.ytimg.com/an_webp/`), and CSS hides any clip that slips through.
- **YouTube video ads skipped:** an ad is fast-forwarded (muted, 16x, jumped to just before its end), then the lecture's volume and speed are restored. A pre-roll that took ~56 s took a few seconds in testing.
- **Ad overlays and ad slots hidden:** "Sponsored / Shop now" cards, companion ads, in-feed ad slots.
- **Ads blocked everywhere:** the ad blocker is forced on during a session, even on sites where the user allowed ads.
- A small notice under the video says focus view is on.
- Turning Study Mode on applies all of this to tabs already open; turning it off restores them immediately.

## How it works

- **Rules** live in `policy/focus.json` (backend policy, like the block and allow lists; served by the gateway, bundled in the app). Each rule lists sites and CSS selectors to hide. Only selectors are accepted (`shared/focus-rules.ts` rejects `{ } ; @`, comments and unbalanced brackets), so a policy file can hide elements but never inject other CSS. Selectors are wrapped in a forgiving `:is()` list, so a renamed element on the site doesn't disable the others.
- **FocusView** (`main/study/focus-view.ts`) inserts the stylesheet once per document at `dom-ready` (before the page paints), scoped to `html[data-studynest-focus]`, and Study Mode only sets or removes that attribute from an isolated script world.
- **YouTube helper** (`main/study/youtube-focus-script.ts`) runs in the same isolated world on YouTube pages and acts only while the attribute is set: it skips in-video ads, and when a card's thumbnail is swapped for an animated hover clip it puts the still image back.
- Updates for one page run one after another, because inserting CSS and running scripts are asynchronous.

## Challenges

- **Electron 31's `removeInsertedCSS` does nothing after a reload.** Inserting and removing a stylesheet left pages hidden after Study Mode ended. Found by logging every insert/remove, then confirmed at the API level. Fix: never remove CSS; toggle an attribute the stylesheet is scoped to. This also avoids sites' Content-Security-Policy, which can block injected `<style>` elements.
- **Overlapping updates** (a reload's document-ready and a Study Mode change at the same moment) could insert two stylesheets. Fix: per-page update queue.
- **YouTube ignores scripted clicks on Skip, and seeking an ad to its exact end stalls the player ~10 s.** Fix: seek to 0.6 s before the end at 16x and let the ad finish itself.
- **Hover previews that aren't videos.** The first version hid YouTube's hover player, but the newer "Up next" cards animate by swapping the thumbnail for a moving WebP image (found from a user report and YouTube's `animatedThumbnail` data). Fix: restore the still image, refuse `an_webp` downloads during Study Mode, and hide any that load.
- **Filter-list scriptlets break YouTube** (Phase 7), so ads inside the player are handled by the skipper instead of the ad blocker.

## Configure

Add selectors to `policy/focus.json` to hide more, for example `"ytd-watch-flexy #secondary"` (recommendations) or `"ytd-comments"` (comments). Apps pick up changes on start.

## Verification

- Unit tests: selector safety, rule sanitizing, stylesheet building, the shipped `focus.json`, FocusView switching and the ad skipper being installed once per YouTube document.
- `daily` e2e suite: focus view off without Study Mode, on when a session starts on an open page, kept after a reload, removed when the session ends.
- Live YouTube in the app: sidebar visible (13 "Up next" items), hover previews hidden, notice shown, ads skipped and the lecture playing with sound afterwards.
