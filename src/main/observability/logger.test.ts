import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Logger } from './logger.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempLog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studynest-log-'));
  tempDirs.push(dir);
  return path.join(dir, 'logs', 'app.log');
}

describe('Logger', () => {
  it('writes JSON lines, honours the level, and redacts secrets', () => {
    const filePath = tempLog();
    const logger = new Logger({ filePath, minLevel: 'info', now: () => 42 });
    logger.scope('ai').debug('hidden');
    logger.scope('ai').info('configured', { apiKey: 'sk-ant-123', provider: 'anthropic', error: new Error('x') });

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { at: 42, level: 'info', scope: 'ai', message: 'configured', data: { apiKey: '[redacted]', provider: 'anthropic', error: 'x' } }
    ]);
  });

  it('rotates when the file is too large', () => {
    const filePath = tempLog();
    const logger = new Logger({ filePath, maxBytes: 200 });
    for (let index = 0; index < 10; index += 1) {
      logger.write('info', 'test', `message number ${index} with some padding`);
    }
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.statSync(filePath).size).toBeLessThan(400);
  });

  it('keeps recent problems for diagnostics, newest first', () => {
    const logger = new Logger({ filePath: null });
    logger.write('info', 'a', 'fine');
    logger.write('warn', 'a', 'first');
    logger.write('error', 'b', 'second');
    expect(logger.getRecentProblems().map((record) => record.message)).toEqual(['second', 'first']);
  });
});
