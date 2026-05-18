#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targetArg = process.argv[2];
if (!targetArg || targetArg === '--help' || targetArg === '-h') {
  console.log('Usage: npm create promptframe-component <component-dir> [--display-name "Sales Funnel"]');
  process.exit(targetArg ? 0 : 1);
}

const targetDir = resolve(targetArg);
if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
  console.error(`create.target_not_empty: ${targetDir} is not empty`);
  process.exit(1);
}

const componentName = toKebabName(targetArg.split(/[\\/]/).filter(Boolean).at(-1) ?? 'promptframe-component');
const displayName = valueAfter(process.argv.slice(3), '--display-name') ?? toTitle(componentName);
const description = valueAfter(process.argv.slice(3), '--description') ?? `${displayName} PromptFrame component`;
const packageRoot = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(packageRoot, '../templates/react-remotion');

copyTemplate(templateDir, targetDir, {
  __COMPONENT_NAME__: componentName,
  __DISPLAY_NAME__: displayName,
  __DESCRIPTION__: description,
});

console.log(`Created PromptFrame component at ${targetDir}`);
console.log('Next steps: npm install && npm run validate');

function copyTemplate(from: string, to: string, replacements: Record<string, string>): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    const stat = statSync(src);
    if (stat.isDirectory()) {
      copyTemplate(src, dest, replacements);
      continue;
    }
    if (isTextFile(src)) {
      let text = readFileSync(src, 'utf8');
      for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(key, value);
      writeFileSync(dest, text);
    } else {
      copyFileSync(src, dest);
    }
  }
}

function isTextFile(path: string): boolean {
  return /\.(json|md|js|ts|tsx|yml|yaml|css|html)$/.test(path);
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function toKebabName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'promptframe-component';
}

function toTitle(value: string): string {
  return value.split('-').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}
