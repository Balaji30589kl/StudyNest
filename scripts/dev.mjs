// `npm run dev`: starts the AI gateway (when gateway/.env has an API key and it
// isn't already running), then the app in development mode. Stopping the app
// stops the gateway this script started. `npm run dev:app` starts only the app.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'gateway', '.env');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const log = (message) => console.log(`[studynest] ${message}`);

function hasApiKey() {
  if (!fs.existsSync(envFile)) return false;
  const text = fs.readFileSync(envFile, 'utf-8');
  return /^(ANTHROPIC_API_KEY|GEMINI_API_KEY)=\S+/m.test(text);
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

let gateway = null;
if (!hasApiKey()) {
  log('gateway/.env has no API key: AI checks use offline keyword rules. See gateway/README.md.');
} else if (await portInUse(8787)) {
  log('AI gateway already running on port 8787.');
} else {
  log('building and starting the AI gateway…');
  const build = spawnSync(npm, ['run', 'gateway:build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status === 0) {
    gateway = spawn(process.execPath, [path.join(root, 'gateway', 'dist', 'gateway', 'src', 'main.js')], { cwd: path.join(root, 'gateway'), stdio: ['ignore', 'inherit', 'inherit'] });
    gateway.on('exit', (code) => code && log(`AI gateway exited (code ${code}); AI checks fall back to offline rules.`));
  } else {
    log('gateway build failed; AI checks fall back to offline rules.');
  }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // Set by VS Code's terminal; it would make Electron start as plain Node.
const app = spawn(npm, ['run', 'dev:app'], { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });

const stop = () => {
  if (gateway && !gateway.killed) gateway.kill();
};
app.on('exit', (code) => {
  stop();
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
