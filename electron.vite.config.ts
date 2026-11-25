import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for the browser chrome, added to production builds
 * only (the Vite dev server needs inline scripts for hot reload).
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: http:",
  "font-src 'self' data:",
  'connect-src https://duckduckgo.com',
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'studynest-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
    }
  };
}

export default defineConfig({
  main: {
    // Runtime dependencies (Anthropic SDK, electron-updater) stay in node_modules
    // and are packaged by electron-builder instead of being bundled.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main'
    }
  },
  preload: {
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
    build: {
      outDir: 'dist'
    }
  }
});
