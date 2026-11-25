import { ipcMain, IpcMainInvokeEvent, WebContents } from 'electron';

let trusted: WebContents | null = null;
let rejected = 0;

/** Registers the browser chrome as the only web contents allowed to call main. */
export function setTrustedSender(webContents: WebContents): void {
  trusted = webContents;
}

export function rejectedIpcCount(): number {
  return rejected;
}

/**
 * True only for the browser chrome's own top-level frame. Web pages in tabs
 * have no preload today, but this keeps IPC closed even if that changes or a
 * page manages to load inside the chrome window.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return (
    trusted !== null &&
    !trusted.isDestroyed() &&
    event.sender.id === trusted.id &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame
  );
}

/** Drop-in replacement for ipcMain.handle that rejects untrusted senders. */
export function handleTrusted<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      rejected += 1;
      throw new Error(`Rejected IPC call to ${channel} from an untrusted sender.`);
    }
    return handler(event, ...(args as Args));
  });
}
