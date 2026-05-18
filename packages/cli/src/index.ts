#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  COMPONENT_REF_VERSION,
  COMPONENT_STANDARD_VERSION,
  PROMPTFRAME_CONTRACTS_VERSION,
  parseComponentManifest,
} from '@promptframe/contracts';

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

class PromptFrameCliError extends Error {
  constructor(message: string, public readonly code: string, public readonly exitCode = 1) {
    super(message);
  }
}

try {
  switch (command) {
    case 'standard':
      printJson({
        contractsVersion: PROMPTFRAME_CONTRACTS_VERSION,
        manifestSchemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
        componentStandardVersion: COMPONENT_STANDARD_VERSION,
        componentRefVersion: COMPONENT_REF_VERSION,
        supportedComponentTypes: ['scene_template', 'contained_widget', 'overlay', 'transition_effect'],
      });
      break;
    case 'doctor':
      doctor(args[0] ?? '.');
      break;
    case 'validate':
      validate(args[0] ?? '.');
      break;
    case 'package':
      packageComponent(args);
      break;
    case 'upload':
    case 'status':
    case 'reindex':
    case 'probe':
      remoteCommand(command, args);
      break;
    case 'configure':
      configure(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    default:
      fail(`Unknown command: ${command}`, 'cli.command.unknown');
  }
} catch (error) {
  if (error instanceof PromptFrameCliError) {
    console.error(`${error.code}: ${error.message}`);
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function doctor(componentDir: string): void {
  const dir = resolve(componentDir);
  const required = [
    'package.json',
    'manifest.json',
    'src/Component.tsx',
    'src/schema.ts',
    'src/preview-props.json',
  ];
  const missing = required.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) {
    fail(`Missing required files: ${missing.join(', ')}`, 'doctor.required_files.missing');
  }
  console.log(`doctor passed: ${dir}`);
}

function validate(componentDir: string): void {
  doctor(componentDir);
  const dir = resolve(componentDir);
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  parseComponentManifest(normalizeLegacyManifest(manifest));
  checkImportBoundary(dir);
  console.log(`validate passed: ${dir}`);
}

function packageComponent(argv: string[]): void {
  const componentDir = argv[0] ?? '.';
  validate(componentDir);
  const dir = resolve(componentDir);
  const out = valueAfter(argv, '--out') ?? `${dir.replace(/[\\/]$/, '')}.tgz`;
  const result = spawnSync('tar', ['-czf', out, '-C', dir, '.'], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(result.stderr || 'tar failed while packaging component', 'package.tar.failed');
  }
  const sizeBytes = statSync(out).size;
  const sha256 = createHash('sha256').update(readFileSync(out)).digest('hex');
  printJson({ out, sizeBytes, sha256: `sha256:${sha256}` });
}

function remoteCommand(name: string, argv: string[]): void {
  const endpoint = valueAfter(argv, '--endpoint') ?? process.env.PROMPTFRAME_API_BASE ?? process.env.REMOTION_MEDIA_API_BASE;
  if (!endpoint) {
    fail(
      `${name} requires --endpoint, PROMPTFRAME_API_BASE, or REMOTION_MEDIA_API_BASE. No default production endpoint is embedded in the public CLI.`,
      `${name}.endpoint.missing`,
      2,
    );
  }
  printJson({
    command: name,
    endpoint,
    status: 'not_implemented_first_slice',
    diagnostic: `${name}.transport.pending`,
  });
}

function configure(argv: string[]): void {
  const endpoint = valueAfter(argv, '--endpoint');
  if (!endpoint) fail('configure requires --endpoint <url>', 'configure.endpoint.missing', 2);
  printJson({
    status: 'not_persisted_first_slice',
    endpoint,
    diagnostic: 'configure.storage.pending',
  });
}

function checkImportBoundary(dir: string): void {
  const component = readIfExists(join(dir, 'src/Component.tsx'));
  const schema = readIfExists(join(dir, 'src/schema.ts'));
  const joined = `${component}\n${schema}`;
  if (/\bfrom\s+['"]\.\.\//.test(joined) || /\bimport\s*\(\s*['"]\.\.\//.test(joined)) {
    fail('Component source imports from outside the component directory.', 'package.no_parent_imports');
  }
}

function normalizeLegacyManifest(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.componentType === 'string') return input;
  if (input.layer === 'scene_template' || input.category === 'scene_template') {
    return { ...input, componentType: 'scene_template' };
  }
  return input;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string, code: string, exitCode = 1): never {
  throw new PromptFrameCliError(message, code, exitCode);
}

function help(): void {
  console.log(`PromptFrame CLI

Commands:
  standard                 Print current public component standard versions
  doctor <dir>             Check required component files
  validate <dir>           Validate manifest and basic source boundaries
  package <dir> --out <tgz> Validate and package a component directory
  upload/status/reindex/probe  Endpoint-backed commands; require --endpoint or env
`);
}
