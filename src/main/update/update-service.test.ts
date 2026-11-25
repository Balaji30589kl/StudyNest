import { describe, expect, it, vi } from 'vitest';
import { UpdaterAdapter, UpdateService } from './update-service.js';

class FakeUpdater implements UpdaterAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers = new Map<string, (...args: any[]) => void>();
  checkForUpdates = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void) {
    this.handlers.set(event, listener);
    return this;
  }
  emit(event: string, arg?: unknown) {
    this.handlers.get(event)?.(arg);
  }
}

function service(environment = { currentVersion: '0.3.0', isPackaged: true, isPortable: false }) {
  const updater = new FakeUpdater();
  const createUpdater = vi.fn(() => updater);
  return { updates: new UpdateService({ environment, createUpdater, now: () => 1000 }), updater, createUpdater };
}

describe('UpdateService', () => {
  it('is disabled in development and portable builds, without loading the updater', async () => {
    const dev = service({ currentVersion: '0.3.0', isPackaged: false, isPortable: false });
    expect(dev.updates.getState()).toMatchObject({ status: 'disabled', message: expect.stringContaining('installed app') });
    await dev.updates.check();
    expect(dev.createUpdater).not.toHaveBeenCalled();

    const portable = service({ currentVersion: '0.3.0', isPackaged: true, isPortable: true });
    expect(portable.updates.getState()).toMatchObject({ status: 'disabled', message: expect.stringContaining('portable') });
  });

  it('walks through check, download and ready-to-install', async () => {
    const { updates, updater } = service();
    const changes = vi.fn();
    updates.onChange(changes);

    await updates.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    updater.emit('checking-for-update');
    expect(updates.getState().status).toBe('checking');
    updater.emit('update-available', { version: '0.4.0' });
    updater.emit('download-progress', { percent: 41.6 });
    expect(updates.getState()).toMatchObject({ status: 'downloading', availableVersion: '0.4.0', percent: 42 });
    updater.emit('update-downloaded', { version: '0.4.0' });
    expect(updates.getState()).toMatchObject({ status: 'downloaded', availableVersion: '0.4.0', percent: 100 });
    expect(changes).toHaveBeenCalled();

    // Further checks don't interrupt a downloaded update.
    await updates.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();

    updates.installNow();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('reports up-to-date and friendly errors', async () => {
    const { updates, updater } = service();
    await updates.check();
    updater.emit('update-not-available', { version: '0.3.0' });
    expect(updates.getState()).toMatchObject({ status: 'up-to-date', lastCheckedAt: 1000 });

    updater.emit('error', new Error('HttpError: 404 Not Found'));
    expect(updates.getState()).toMatchObject({ status: 'error', message: 'No published release was found yet.' });

    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await updates.check();
    expect(updates.getState().message).toContain("Couldn't reach");

    updater.emit('error', new Error("ENOENT: no such file or directory, open 'C:/app/resources/app-update.yml'"));
    expect(updates.getState().message).toContain('Setup installer');

    updater.emit('update-not-available', { version: '0.3.0' });
    expect(updates.getState().message).toBeUndefined();
  });

  it('does nothing when asked to install before a download finished', async () => {
    const { updates, updater } = service();
    await updates.check();
    updates.installNow();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
