// Renders build/icon.png (512x512) from an inline SVG using Electron.
// Run: npx electron scripts/generate-icon.cjs   (unset ELECTRON_RUN_AS_NODE first)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#60a5fa"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <text x="256" y="350" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="300" font-weight="800" fill="#0f172a">S</text>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true }
  });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.writeFileSync(out, image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`wrote ${out} (${image.getSize().width}x${image.getSize().height})`);
  app.quit();
});
