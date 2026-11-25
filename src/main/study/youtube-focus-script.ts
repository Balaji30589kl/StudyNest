/**
 * StudyNest's YouTube helper during Study Mode, run in an isolated script world:
 *
 * 1. Skips in-video ads. Filter lists can only block
 * these by injecting scripts into YouTube's own code, which breaks the player,
 * so instead this runs in StudyNest's isolated script world and does what a
 * person would: try Skip, and fast-forward the ad muted to just before its end
 * so it finishes in about a second, then restore the volume and speed for the
 * lecture.
 *
 * 2. Keeps thumbnails still: when YouTube swaps a card's thumbnail for an
 *    animated hover clip, the still image is restored.
 *
 * It acts only while <html data-studynest-focus> is set, so it stops the moment
 * Study Mode ends. It is installed once per document.
 */
export const YOUTUBE_FOCUS_SCRIPT = `(() => {
  if (window.__studynestAdSkipper) return;
  window.__studynestAdSkipper = true;
  let saved = null;
  const tick = () => {
    const player = document.querySelector('#movie_player');
    const video = player && player.querySelector('video');
    if (!player || !video) return;
    const focus = document.documentElement.hasAttribute('data-studynest-focus');
    const adPlaying = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    if (focus && adPlaying) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
      const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button[id^="skip-button"]');
      if (skip) skip.click();
      // Jump to just before the end and let the ad finish on its own at 16x. Seeking
      // to the very end makes YouTube stall for about 10 s waiting for the ad to
      // report that it finished; YouTube ignores scripted clicks on Skip.
      video.muted = true;
      try { video.playbackRate = 16; } catch (error) {}
      if (Number.isFinite(video.duration) && video.duration > 1.5 && video.currentTime < video.duration - 1) {
        video.currentTime = video.duration - 0.6;
      }
    } else if (saved) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
      saved = null;
    }
  };
  setInterval(tick, 250);

  // Animated thumbnails: newer cards ("Up next") swap the thumbnail's address to a
  // moving WebP clip on hover. During Study Mode the still image is put straight
  // back (the clip's download is also refused, and CSS hides any clip that slips in).
  const stills = new WeakMap();
  const isClip = (src) => typeof src === 'string' && src.includes('/an_webp/');
  new MutationObserver((records) => {
    const focus = document.documentElement.hasAttribute('data-studynest-focus');
    for (const record of records) {
      const img = record.target;
      if (!(img instanceof HTMLImageElement)) continue;
      const src = img.getAttribute('src') || '';
      if (!isClip(src)) {
        if (src) stills.set(img, src);
        continue;
      }
      if (!focus) continue;
      const still = record.oldValue && !isClip(record.oldValue) ? record.oldValue : stills.get(img);
      if (still) img.setAttribute('src', still);
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'], attributeOldValue: true });
})();`;

export function isYouTubeHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return normalized === 'youtube.com' || normalized.endsWith('.youtube.com');
}
