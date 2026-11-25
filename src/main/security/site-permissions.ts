import { BrowserWindow, dialog, Session, WebContents } from 'electron';
import type { SitePermissionEntry as Entry } from './permission-policy.js';
import {
  answerPermissionCheck,
  classifyPermission,
  describePermission,
  originOf,
  PermissionDetails,
  permissionKey,
  StoredDecision
} from './permission-policy.js';
import type { JsonFileStore } from '../storage/json-file-store.js';

type Logger = (message: string, data?: Record<string, unknown>) => void;

/**
 * Applies the permission policy to web content in tabs. The browser chrome
 * itself is denied everything except clipboard writes. Prompts are native,
 * one at a time, and can be remembered per site.
 */
export class SitePermissions {
  private entries: Entry[];
  private readonly listeners = new Set<() => void>();
  private promptChain: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly window: BrowserWindow,
    private readonly store: JsonFileStore<Entry[]>,
    private readonly log: Logger = () => undefined
  ) {
    this.entries = store.load();
  }

  install(session: Session): void {
    session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      void this.request(webContents, permission, details as PermissionDetails & { requestingUrl?: string }).then(callback);
    });
    session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      if (!webContents || webContents.id === this.window.webContents.id) {
        return permission === 'clipboard-sanitized-write';
      }
      const origin = originOf(requestingOrigin) ?? originOf(webContents.getURL());
      return origin ? answerPermissionCheck(this.entries, origin, permission) : false;
    });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): Entry[] {
    return [...this.entries].sort((a, b) => a.origin.localeCompare(b.origin) || a.key.localeCompare(b.key));
  }

  reset(origin?: string, key?: string): Entry[] {
    this.entries = this.entries.filter((entry) => (origin ? entry.origin !== origin || (key !== undefined && entry.key !== key) : false));
    this.persist();
    return this.list();
  }

  private async request(webContents: WebContents, permission: string, details: PermissionDetails & { requestingUrl?: string }): Promise<boolean> {
    if (webContents.id === this.window.webContents.id) {
      return permission === 'clipboard-sanitized-write';
    }

    const verdict = classifyPermission(permission);
    if (verdict !== 'ask') {
      if (verdict === 'deny') {
        this.log('permission denied by policy', { permission });
      }
      return verdict === 'allow';
    }

    const origin = originOf(details.requestingUrl ?? webContents.getURL());
    if (!origin) {
      return false;
    }

    const key = permissionKey(permission, details);
    const stored = this.entries.find((entry) => entry.origin === origin && entry.key === key);
    if (stored) {
      return stored.decision === 'allow';
    }

    const pendingKey = `${origin}|${key}`;
    const existing = this.pending.get(pendingKey);
    if (existing) {
      return existing;
    }

    // Serialize prompts so the user is never shown two dialogs at once.
    const prompt = this.promptChain.then(() => this.prompt(origin, key, permission, details));
    this.promptChain = prompt.catch(() => undefined);
    this.pending.set(pendingKey, prompt);
    try {
      return await prompt;
    } finally {
      this.pending.delete(pendingKey);
    }
  }

  private async prompt(origin: string, key: string, permission: string, details: PermissionDetails): Promise<boolean> {
    if (this.window.isDestroyed()) {
      return false;
    }
    const host = new URL(origin).host;
    const result = await dialog.showMessageBox(this.window, {
      type: 'question',
      title: 'Site permission',
      message: `${host} wants to ${describePermission(permission, details)}`,
      detail: 'You can change this later in Settings → Site permissions.',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: 'Remember my choice for this site',
      checkboxChecked: true,
      noLink: true
    });
    const decision: StoredDecision = result.response === 0 ? 'allow' : 'deny';
    this.log('permission decided', { permission: key, decision, remembered: result.checkboxChecked });
    if (result.checkboxChecked) {
      this.entries = this.entries.filter((entry) => !(entry.origin === origin && entry.key === key));
      this.entries.push({ origin, key, decision, decidedAt: Date.now() });
      this.persist();
    }
    return decision === 'allow';
  }

  private persist(): void {
    this.store.save([...this.entries]);
    for (const listener of this.listeners) {
      listener();
    }
  }
}
