// Runs the end-to-end suites against the built app (`npm run build` first).
// Usage: node e2e/run.mjs [suite...]
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, REPO_DIR, Results } from './harness.mjs';

const SUITES = ['study', 'ai', 'product', 'browser', 'security', 'ui'];
// Opt-in: needs `npm run dist:win` output.
const OPTIONAL_SUITES = ['packaged'];
const requested = process.argv.slice(2);
const selected = requested.length > 0 ? [...SUITES, ...OPTIONAL_SUITES].filter((suite) => requested.includes(suite)) : SUITES;

if (!fs.existsSync(path.join(REPO_DIR, 'dist-electron/main/index.js'))) {
  console.error('Build output not found. Run `npm run build` first.');
  process.exit(1);
}

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let failed = 0;
let passed = 0;
for (const suite of selected) {
  console.log(`\n${suite}`);
  const results = new Results(suite);
  try {
    const module = await import(`./suites/${suite}.mjs`);
    await module.default(results);
  } catch (error) {
    results.check('suite completed without throwing', false, error?.stack ?? error);
  }
  failed += results.failed;
  passed += results.items.length - results.failed;
}

console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${path.relative(REPO_DIR, OUTPUT_DIR)}`);
process.exit(failed > 0 ? 1 : 0);
