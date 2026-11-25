import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FALLBACK_POLICY, sanitizeStudyPolicy, StudyPolicy } from '../../src/shared/study-policy.js';

export type PolicyDocument = StudyPolicy & { version: string };

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Reads blocklist.json, allowlist.json and classification.json from the policy
 * folder. The version is a content hash, so clients can tell when it changed.
 */
export function loadPolicy(dir: string): PolicyDocument {
  const policy = sanitizeStudyPolicy(
    {
      block: readJson(path.join(dir, 'blocklist.json')),
      allow: readJson(path.join(dir, 'allowlist.json')),
      classification: readJson(path.join(dir, 'classification.json'))
    },
    FALLBACK_POLICY
  );
  const version = createHash('sha256').update(JSON.stringify(policy)).digest('hex').slice(0, 16);
  return { ...policy, version };
}
