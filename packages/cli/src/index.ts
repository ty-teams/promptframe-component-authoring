#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  COMPONENT_REF_VERSION,
  COMPONENT_STANDARD_VERSION,
  PROMPTFRAME_CONTRACTS_VERSION,
  parseComponentManifest,
  type ComponentManifest,
  type PublicPolicyRuleId,
} from '@promptframe/contracts';

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

const REQUIRED_COMPONENT_FILES = [
  'package.json',
  'manifest.json',
  'src/Component.tsx',
  'src/schema.ts',
  'src/preview-props.json',
] as const;

const VALIDATE_CHECKED_RULE_IDS: PublicPolicyRuleId[] = [
  'manifest.identity.version',
  'manifest.component_type.supported',
  'evidence.schema_source_hash_present',
  'package.no_parent_imports',
];

class PromptFrameCliError extends Error {
  constructor(message: string, public readonly code: string, public readonly exitCode = 1) {
    super(message);
  }
}

async function run(name: string, argv: string[]): Promise<void> {
  switch (name) {
    case 'standard':
      standard();
      break;
    case 'doctor':
      doctor(argv);
      break;
    case 'validate':
      validate(argv);
      break;
    case 'package':
      packageComponent(argv);
      break;
    case 'upload':
    case 'status':
    case 'reindex':
    case 'probe':
      await remoteCommand(name, argv);
      break;
    case 'configure':
      configure(argv);
      break;
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    default:
      fail(`Unknown command: ${name}`, 'cli.command.unknown');
  }
}

function standard(): void {
  printJson({
    command: 'standard',
    contractsVersion: PROMPTFRAME_CONTRACTS_VERSION,
    manifestSchemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    componentStandardVersion: COMPONENT_STANDARD_VERSION,
    componentRefVersion: COMPONENT_REF_VERSION,
    supportedComponentTypes: ['scene_template', 'contained_widget', 'overlay', 'transition_effect'],
    diagnostic: diagnostic('standard.completed', 'info', 'Public PromptFrame component standard fetched.'),
  });
}

function doctor(argv: string[]): void {
  const dir = resolve(firstPositionalArg(argv) ?? '.');
  assertRequiredFiles(dir);
  const output = {
    command: 'doctor',
    dir,
    requiredFiles: REQUIRED_COMPONENT_FILES,
    diagnostic: diagnostic('doctor.completed', 'info', 'Component directory contains required authoring files.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`doctor passed: ${dir}`);
}

function validate(argv: string[]): void {
  const dir = resolve(firstPositionalArg(argv) ?? '.');
  const manifest = validateComponentDirectory(dir);
  const output = {
    command: 'validate',
    dir,
    manifest: {
      id: manifest.id,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      componentType: manifest.componentType ?? manifest.layer,
    },
    checkedRuleIds: VALIDATE_CHECKED_RULE_IDS,
    diagnostic: diagnostic('validate.completed', 'info', 'Component manifest and public source boundaries validated.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`validate passed: ${dir}`);
}

function packageComponent(argv: string[]): void {
  const artifact = packageDirectory(argv[0] ?? '.', valueAfter(argv, '--out'));
  printJson({
    command: 'package',
    diagnostic: diagnostic('package.completed', 'info', 'Component source archive created.'),
    out: artifact.out,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  });
}

function validateComponentDirectory(dir: string): ComponentManifest {
  assertRequiredFiles(dir);
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const parsed = parseComponentManifest(normalizeLegacyManifest(manifest));
  checkImportBoundary(dir);
  return parsed;
}

function packageDirectory(componentDir: string, outArg?: string): { out: string; sizeBytes: number; sha256: string } {
  const dir = resolve(componentDir);
  const manifest = validateComponentDirectory(dir);
  const out = resolve(outArg ?? join(dir, '.component-packages', `${manifest.name}.zip`));
  const files = collectPackageFiles(dir);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildStoredZip(files));
  const sizeBytes = statSync(out).size;
  const sha256 = `sha256:${createHash('sha256').update(readFileSync(out)).digest('hex')}`;
  return { out, sizeBytes, sha256 };
}

async function remoteCommand(name: 'upload' | 'status' | 'reindex' | 'probe', argv: string[]): Promise<void> {
  switch (name) {
    case 'upload':
      await uploadComponent(argv);
      break;
    case 'status':
      await showStatus(argv);
      break;
    case 'reindex':
      await reindexEvidence(argv);
      break;
    case 'probe':
      await runProbe(argv);
      break;
  }
}

async function uploadComponent(argv: string[]): Promise<void> {
  const target = resolve(argv[0] ?? '.');
  const endpoint = resolveEndpoint('upload', argv);
  const artifact = target.endsWith('.zip')
    ? packageArtifactFromZip(target)
    : packageDirectory(target, valueAfter(argv, '--out'));
  const file = readFileSync(artifact.out);
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)], { type: 'application/zip' }), basename(artifact.out));
  const payload = await fetchJson(`${endpoint}/components/marketplace/upload`, {
    method: 'POST',
    body: form,
    headers: buildContextHeaders(argv),
  }, 'upload.http.failed');
  const output = {
    ...payload,
    command: 'upload',
    endpoint,
    jobId: getBuildId(payload),
    package: artifact,
    diagnostic: diagnostic('upload.completed', 'info', 'Component upload accepted by platform.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log('Upload accepted by PromptFrame platform.');
  console.log(`Build: ${output.jobId ?? 'unknown'}`);
  console.log(`Status: ${stringValue(payload.status) ?? stringValue(asRecord(payload.build)?.status) ?? 'queued'}`);
  printStatusUrl(endpoint, payload);
}

async function showStatus(argv: string[]): Promise<void> {
  const buildId = requiredArg(argv[0], 'status requires a build id', 'status.build_id.missing');
  const endpoint = resolveEndpoint('status', argv);
  const payload = await fetchJson(`${endpoint}/components/marketplace/builds/${encodeURIComponent(buildId)}`, {
    headers: buildContextHeaders(argv),
  }, 'status.http.failed');
  const output = {
    ...payload,
    command: 'status',
    endpoint,
    diagnostic: diagnostic('status.completed', 'info', 'Component build status fetched.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  printBuildSummary(output);
}

async function reindexEvidence(argv: string[]): Promise<void> {
  const buildId = requiredArg(argv[0], 'reindex requires a build id', 'reindex.build_id.missing');
  const endpoint = resolveEndpoint('reindex', argv);
  const body = compactRecord({
    providerKind: valueAfter(argv, '--provider-kind'),
    providerName: valueAfter(argv, '--provider-name'),
  });
  const payload = await fetchJson(`${endpoint}/components/marketplace/builds/${encodeURIComponent(buildId)}/evidence/reindex`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildContextHeaders(argv),
    },
    body: JSON.stringify(body),
  }, 'reindex.http.failed');
  const output = {
    ...payload,
    command: 'reindex',
    endpoint,
    diagnostic: diagnostic('reindex.completed', 'info', 'Component evidence reindex requested.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log('Evidence reindex completed.');
  console.log(`Evidence items: ${arrayValue(payload.evidence).length}`);
  console.log(`Providers: ${arrayValue(payload.providers).length}`);
}

async function runProbe(argv: string[]): Promise<void> {
  const buildId = requiredArg(argv[0], 'probe requires a build id', 'probe.build_id.missing');
  const endpoint = resolveEndpoint('probe', argv);
  const level = valueAfter(argv, '--level') ?? 'quick';
  const payload = await fetchJson(`${endpoint}/components/marketplace/builds/${encodeURIComponent(buildId)}/probes/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildContextHeaders(argv),
    },
    body: JSON.stringify({ level }),
  }, 'probe.http.failed');
  const output = {
    ...payload,
    command: 'probe',
    endpoint,
    diagnostic: diagnostic('probe.completed', 'info', 'Component layout/security probe rerun requested.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  const probe = asRecord(payload.probe);
  console.log(`Probe: ${stringValue(probe?.level) ?? level} -> ${stringValue(probe?.status) ?? 'unknown'}`);
  for (const item of arrayValue(probe?.diagnostics)) {
    const diagnosticItem = asRecord(item);
    console.log(`${stringValue(diagnosticItem?.severity)?.toUpperCase() ?? 'INFO'} ${stringValue(diagnosticItem?.code) ?? 'unknown'}: ${stringValue(diagnosticItem?.message) ?? ''}`);
  }
}

function configure(argv: string[]): void {
  const current = readConfig(argv);
  const next = compactRecord({
    ...current,
    endpoint: valueAfter(argv, '--endpoint') ? normalizeEndpoint(requiredValue(argv, '--endpoint')) : current.endpoint,
    tenantId: valueAfter(argv, '--tenant-id') ?? current.tenantId,
    userId: valueAfter(argv, '--user-id') ?? current.userId,
    projectId: valueAfter(argv, '--project-id') ?? current.projectId,
    sessionId: valueAfter(argv, '--session-id') ?? current.sessionId,
  });
  if (hasFlag(argv, '--show')) {
    printJson({ configPath: resolveConfigPath(argv), config: redactConfig(next) });
    return;
  }
  const changed = ['--endpoint', '--tenant-id', '--user-id', '--project-id', '--session-id']
    .some((flag) => valueAfter(argv, flag) !== undefined);
  if (!changed) {
    printJson({ configPath: resolveConfigPath(argv), config: redactConfig(next) });
    return;
  }
  writeConfig(argv, next);
  printJson({
    command: 'configure',
    configPath: resolveConfigPath(argv),
    config: redactConfig(next),
    diagnostic: diagnostic('configure.completed', 'info', 'Local PromptFrame CLI config written.'),
  });
}

function resolveEndpoint(commandName: string, argv: string[]): string {
  const config = readConfig(argv);
  const endpoint = valueAfter(argv, '--endpoint')
    ?? process.env.PROMPTFRAME_API_BASE
    ?? process.env.REMOTION_MEDIA_API_BASE
    ?? stringValue(config.endpoint);
  if (!endpoint) {
    fail(
      `${commandName} requires --endpoint, PROMPTFRAME_API_BASE, REMOTION_MEDIA_API_BASE, or local config. No default production endpoint is embedded in the public CLI.`,
      `${commandName}.endpoint.missing`,
      2,
    );
  }
  return normalizeEndpoint(endpoint);
}

function buildContextHeaders(argv: string[]): Record<string, string> {
  const config = readConfig(argv);
  return compactRecord({
    'x-tenant-id': valueAfter(argv, '--tenant-id') ?? stringValue(config.tenantId),
    'x-user-id': valueAfter(argv, '--user-id') ?? stringValue(config.userId),
    'x-project-id': valueAfter(argv, '--project-id') ?? stringValue(config.projectId),
    'x-session-id': valueAfter(argv, '--session-id') ?? stringValue(config.sessionId),
  });
}

function readConfig(argv: string[]): Record<string, unknown> {
  const path = resolveConfigPath(argv);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(argv: string[], config: Record<string, unknown>): void {
  const path = resolveConfigPath(argv);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function resolveConfigPath(argv: string[]): string {
  return resolve(valueAfter(argv, '--config') ?? process.env.PROMPTFRAME_CONFIG ?? join(os.homedir(), '.promptframe', 'component-authoring.json'));
}

async function fetchJson(url: string, init: RequestInit, code: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.success === false) {
    fail(stringValue(payload.error) ?? `${url} failed: HTTP ${response.status}`, code);
  }
  return payload;
}

function assertRequiredFiles(dir: string): void {
  const missing = REQUIRED_COMPONENT_FILES.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) {
    fail(`Missing required files: ${missing.join(', ')}`, 'doctor.required_files.missing');
  }
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

function packageArtifactFromZip(path: string): { out: string; sizeBytes: number; sha256: string } {
  const file = readFileSync(path);
  return {
    out: path,
    sizeBytes: file.byteLength,
    sha256: `sha256:${createHash('sha256').update(file).digest('hex')}`,
  };
}

function collectPackageFiles(root: string): Array<{ name: string; data: Buffer }> {
  const files: Array<{ name: string; data: Buffer }> = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.component-packages', '.promptframe'].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push({
          name: relative(root, full).replace(/\\/g, '/'),
          data: readFileSync(full),
        });
      }
    }
  }
  walk(root);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function buildStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function requiredArg(value: string | undefined, message: string, code: string): string {
  if (!value) fail(message, code, 2);
  return value;
}

function requiredValue(argv: string[], flag: string): string {
  const value = valueAfter(argv, flag);
  if (!value) fail(`${flag} requires a value`, `cli${flag.replaceAll('-', '.')}.missing`, 2);
  return value;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const next = argv[index + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

function firstPositionalArg(argv: string[]): string | undefined {
  return argv.find((arg) => !arg.startsWith('--'));
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  return compactRecord({
    endpoint: config.endpoint,
    tenantId: config.tenantId,
    userId: config.userId,
    projectId: config.projectId,
    sessionId: config.sessionId,
  });
}

function diagnostic(code: string, severity: 'info' | 'warning' | 'error', message: string): Record<string, string> {
  return { code, severity, message };
}

function compactRecord(input: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > 0) output[key] = value;
  }
  return output;
}

function getBuildId(payload: Record<string, unknown>): string | undefined {
  return stringValue(payload.jobId)
    ?? stringValue(payload.buildId)
    ?? stringValue(asRecord(payload.build)?.buildId)
    ?? stringValue(asRecord(payload.build)?.id);
}

function printBuildSummary(payload: Record<string, unknown>): void {
  const build = asRecord(payload.build);
  if (!build) {
    printJson(payload);
    return;
  }
  console.log(`Build: ${stringValue(build.buildId) ?? stringValue(build.id) ?? 'unknown'}`);
  console.log(`Status: ${stringValue(build.status) ?? 'unknown'}`);
  printStatusUrl(stringValue(payload.endpoint) ?? '', build);
  for (const item of arrayValue(build.diagnostics)) {
    const diagnosticItem = asRecord(item);
    console.log(`${stringValue(diagnosticItem?.severity)?.toUpperCase() ?? 'INFO'} ${stringValue(diagnosticItem?.code) ?? 'unknown'}: ${stringValue(diagnosticItem?.message) ?? ''}`);
  }
}

function printStatusUrl(endpoint: string, payload: Record<string, unknown>): void {
  const statusUrl = stringValue(payload.statusUrl) ?? stringValue(asRecord(payload.build)?.statusUrl);
  if (!statusUrl) return;
  if (/^https?:\/\//i.test(statusUrl)) {
    console.log(`Status URL: ${statusUrl}`);
    return;
  }
  console.log(`Status URL: ${endpoint}${statusUrl.startsWith('/') ? statusUrl : `/${statusUrl}`}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
  standard                         Print current public component standard versions
  doctor <dir>                     Check required component files
  validate <dir>                   Validate manifest and basic source boundaries
  package <dir> --out <zip>        Validate and package a component source zip
  upload <dir|zip>                 Upload component source package to PromptFrame
  status <buildId>                 Fetch component build status
  reindex <buildId>                Rebuild component search/evidence indexes
  probe <buildId> --level <level>  Rerun component layout/security probe
  configure --endpoint <url>       Write local CLI endpoint/context config

Endpoint resolution:
  --endpoint, PROMPTFRAME_API_BASE, REMOTION_MEDIA_API_BASE, then local config.
  The public CLI embeds no production/private endpoint defaults.
`);
}

try {
  await run(command, args);
} catch (error) {
  if (error instanceof PromptFrameCliError) {
    if (hasFlag(args, '--json')) {
      console.error(JSON.stringify({
        success: false,
        command,
        diagnostic: diagnostic(error.code, 'error', error.message),
        failureReason: error.message,
        retryable: false,
      }, null, 2));
    } else {
      console.error(`${error.code}: ${error.message}`);
    }
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
