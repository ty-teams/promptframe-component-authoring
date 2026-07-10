#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'dist', '.turbo', '.pnpm-store']);
const filePattern = /\.(cjs|cts|js|json|jsx|md|mjs|mts|ts|tsx|txt|yaml|yml)$/;

const rules = [
  { id: 'secret.npm_token', pattern: /\bNPM_TOKEN\b/ },
  { id: 'secret.api_key_assignment', pattern: /\b(api[_-]?key|access[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*['"][^'"]{8,}/i },
  { id: 'secret.recovery_code', pattern: /\brecovery codes?\b/i },
  { id: 'internal.agent_inbox', pattern: /\bagent-inbox\b|\bagent inbox\b/i },
  { id: 'internal.director_prompt', pattern: /\bDirector system prompt\b|\bsystemPrompt\b/ },
  { id: 'internal.private_endpoint', pattern: /\b(100\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/ },
  { id: 'internal.one_api', pattern: /\bone[-_ ]?api\b/i },
  { id: 'internal.minio_secret', pattern: /\bMINIO_(ROOT_|ACCESS_|SECRET_)?/ },
];

const allowList = new Map([
  ['PUBLIC_EXPORT_POLICY.md', new Set(['secret.npm_token', 'secret.recovery_code', 'internal.one_api', 'internal.minio_secret'])],
  ['AGENTS.md', new Set(['secret.npm_token', 'internal.agent_inbox', 'internal.one_api', 'internal.minio_secret'])],
  ['scripts/public-export-lint.mjs', new Set(rules.map((rule) => rule.id))],
]);

const findings = [];

const releaseWorkflows = [
  ['.github/workflows/publish-contracts.yml', 'contracts'],
  ['.github/workflows/publish-component-kit.yml', 'componentKit'],
  ['.github/workflows/publish-cli.yml', 'cli'],
  ['.github/workflows/publish-create-component.yml', 'createComponent'],
];

for (const [workflow, packageKey] of releaseWorkflows) {
  const text = readFileSync(join(root, workflow), 'utf8');
  if (!text.includes("- 'authoring-release-*'") || !text.includes('id-token: write')) {
    findings.push(`release.oidc_tag_guard_missing: ${workflow}`);
  }
  if (
    !text.includes(`PROMPTFRAME_AUTHORING_RELEASE_PACKAGE_KEY: ${packageKey}`)
    || !text.includes('node scripts/authoring-release-publish.mjs')
    || !text.includes('environment: npm-production')
  ) {
    findings.push(`release.receipt_controller_missing: ${workflow}`);
  }
  if (/npm publish|npm dist-tag|pnpm install|npm install/.test(text)) {
    findings.push(`release.unbounded_publish_path: ${workflow}`);
  }
}

for (const file of walk(root)) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (!filePattern.test(rel)) continue;
  const allowed = allowList.get(rel) ?? new Set();
  const text = readFileSync(file, 'utf8');
  for (const rule of rules) {
    if (allowed.has(rule.id)) continue;
    if (rule.pattern.test(text)) {
      findings.push(`${rule.id}: ${rel}`);
    }
  }
}

if (findings.length > 0) {
  console.error('public-export lint failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('public-export lint passed');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (stat.isFile()) yield path;
  }
}
