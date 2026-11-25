import { app, BrowserWindow, dialog } from 'electron';
import { handleTrusted } from '../security/ipc-guard.js';
import os from 'node:os';
import path from 'node:path';
import { computeInsights } from '../../shared/insights.js';
import { DiagnosticsSnapshot, IPC_CHANNELS } from '../../shared/ipc.js';
import { AccountService, parseAccountData } from '../account/account-service.js';
import type { Logger } from '../observability/logger.js';
import { JsonFileStore } from '../storage/json-file-store.js';
import type { StudyModeService } from '../study/study-mode-service.js';
import { FolderSyncTransport } from '../sync/sync-transport.js';

/**
 * Phase 4 productization services: insights, the local account, sync, and
 * diagnostics. They read Study data through narrow interfaces and never
 * control the browser.
 */
export function setupProductServices(window: BrowserWindow, study: StudyModeService, logger: Logger): AccountService {
  const log = logger.scope('product');
  const startedAt = Date.now();
  const userData = app.getPath('userData');

  const account = new AccountService({
    store: new JsonFileStore(path.join(userData, 'account.json'), (raw) => parseAccountData(raw, undefined, Date.now(), os.hostname())),
    participant: study,
    createTransport: (folder) => new FolderSyncTransport(folder),
    log: (level, message, data) => logger.write(level, 'sync', message, data)
  });

  account.onChange(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.ACCOUNT_STATE_CHANGED, account.getSnapshot());
    }
  });

  // Sync after anything that changes syncable data (settings, session start/end).
  study.onChange((kind) => {
    if (kind === 'policy') {
      account.scheduleSync();
    }
  });

  handleTrusted(IPC_CHANNELS.INSIGHTS_REQUEST, () => computeInsights(study.getSessionHistory(), Date.now()));
  handleTrusted(IPC_CHANNELS.ACCOUNT_STATE_REQUEST, () => account.getSnapshot());
  handleTrusted(IPC_CHANNELS.ACCOUNT_UPDATE_PROFILE, (_event, profile: unknown) => account.updateProfile(profile));
  handleTrusted(IPC_CHANNELS.SYNC_CHOOSE_FOLDER, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a folder to sync StudyNest through',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return account.getSnapshot();
    }
    account.configureSync({ folder: result.filePaths[0] });
    log.info('sync folder configured');
    return account.syncNow();
  });
  handleTrusted(IPC_CHANNELS.SYNC_CONFIGURE, (_event, config: unknown) => {
    const candidate = typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {};
    return account.configureSync({
      // The renderer may only turn sync off; choosing a folder goes through the native dialog.
      ...(candidate.folder === null ? { folder: null } : {}),
      ...(typeof candidate.includeBrowsingDetails === 'boolean' ? { includeBrowsingDetails: candidate.includeBrowsingDetails } : {})
    });
  });
  handleTrusted(IPC_CHANNELS.SYNC_NOW, () => account.syncNow());
  handleTrusted(
    IPC_CHANNELS.DIAGNOSTICS_REQUEST,
    (): DiagnosticsSnapshot => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      platform: `${process.platform} ${os.release()}`,
      dataDirectory: userData,
      logFile: logger.filePath ?? 'disabled',
      uptimeMs: Date.now() - startedAt,
      recentProblems: logger
        .getRecentProblems()
        .slice(0, 15)
        .map((record) => {
          // First line only, capped; the full text stays in the log file.
          const firstLine = record.message.split(/\r?\n/, 1)[0] ?? '';
          const text = `${record.scope}: ${firstLine}`;
          return { at: record.at, level: record.level, message: text.length > 160 ? `${text.slice(0, 157)}...` : text };
        })
    })
  );

  if (account.getSnapshot().sync.folder) {
    void account.syncNow();
  }

  return account;
}
