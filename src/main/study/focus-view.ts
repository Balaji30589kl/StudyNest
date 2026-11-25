import type { WebContents } from 'electron';
import { FOCUS_ATTRIBUTE, focusCssFor, FocusRule } from '../../shared/focus-rules.js';
import type { LoadedPage } from '../tab-manager.js';
import { isYouTubeHost, YOUTUBE_FOCUS_SCRIPT } from './youtube-focus-script.js';

export type FocusViewDeps = {
  getRules: () => FocusRule[];
  isStudyActive: () => boolean;
  /** Pages open right now, to switch the view on or off when Study Mode changes. */
  getOpenPages: () => LoadedPage[];
  log?: (message: string, data?: Record<string, unknown>) => void;
};

/** What has been done to a page's current document. */
type DocumentState = { css: string; on: boolean };

/** Isolated script world used only to set the focus attribute (the page's own scripts can't see it). */
const FOCUS_WORLD_ID = 1789;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Study Mode's focus view: while a session runs, hides distracting elements
 * inside pages (recommendation feeds, hover previews, Shorts, comments).
 *
 * The stylesheet is inserted once per document, scoped to
 * `html[data-studynest-focus]`, and Study Mode switches only that attribute.
 * Removing inserted CSS is unreliable (in Electron 31 `removeInsertedCSS` does
 * nothing after a reload), and an attribute change is not subject to a site's
 * Content-Security-Policy, unlike a <style> element.
 */
export class FocusView {
  private readonly documents = new Map<number, DocumentState>();
  private readonly watched = new Set<number>();
  /** Updates for one page run one after another; inserting CSS and running scripts are asynchronous. */
  private readonly queues = new Map<number, Promise<void>>();

  constructor(private readonly deps: FocusViewDeps) {}

  /** A new document was parsed: style it (and switch the view on if a session is running). */
  onDocumentReady(page: LoadedPage): void {
    this.enqueue(page, true);
  }

  /** Study Mode started or stopped, or the rules changed: update every open page. */
  refresh(): void {
    for (const page of this.deps.getOpenPages()) this.enqueue(page, false);
  }

  /** Waits for queued updates (tests). */
  async settled(): Promise<void> {
    await Promise.all(this.queues.values());
  }

  private enqueue(page: LoadedPage, newDocument: boolean): void {
    const id = page.webContents.id;
    const next = (this.queues.get(id) ?? Promise.resolve()).then(async () => {
      if (newDocument) this.documents.delete(id);
      await this.update(page);
    });
    this.queues.set(id, next);
    void next.finally(() => {
      if (this.queues.get(id) === next) this.queues.delete(id);
    });
  }

  private async update({ url, webContents }: LoadedPage): Promise<void> {
    if (webContents.isDestroyed()) return;
    const id = webContents.id;
    const host = hostOf(url);
    const css = focusCssFor(this.deps.getRules(), host);
    let state = this.documents.get(id);
    try {
      if (!css) {
        if (state?.on) await this.setAttribute(webContents, false);
        if (state) state.on = false;
        return;
      }
      if (!state || state.css !== css) {
        await webContents.insertCSS(css, { cssOrigin: 'user' });
        state = { css, on: state?.on ?? false };
        this.documents.set(id, state);
        this.watch(webContents);
        // YouTube: skip in-video ads (they can't be filtered without breaking the player)
        // and keep hover thumbnails still.
        if (isYouTubeHost(host)) await webContents.executeJavaScriptInIsolatedWorld(FOCUS_WORLD_ID, [{ code: YOUTUBE_FOCUS_SCRIPT }]);
      }
      const want = this.deps.isStudyActive();
      if (state.on !== want) {
        await this.setAttribute(webContents, want);
        state.on = want;
      }
    } catch (error) {
      this.deps.log?.('focus view could not update a page', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async setAttribute(webContents: WebContents, on: boolean): Promise<void> {
    if (webContents.isDestroyed()) return;
    const code = on
      ? `document.documentElement.setAttribute('${FOCUS_ATTRIBUTE}', '')`
      : `document.documentElement.removeAttribute('${FOCUS_ATTRIBUTE}')`;
    await webContents.executeJavaScriptInIsolatedWorld(FOCUS_WORLD_ID, [{ code }]);
  }

  private watch(webContents: WebContents): void {
    const id = webContents.id;
    if (this.watched.has(id)) return;
    this.watched.add(id);
    webContents.once('destroyed', () => {
      this.documents.delete(id);
      this.watched.delete(id);
    });
  }
}
