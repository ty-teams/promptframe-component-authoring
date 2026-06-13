#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  COMPONENT_REF_VERSION,
  COMPONENT_STANDARD_SOURCE_HASH,
  COMPONENT_STANDARD_VERSION,
  PROMPTFRAME_AUTHORING_STANDARD_RELEASE,
  PROMPTFRAME_PUBLIC_RESOURCE_LIMITS,
  PROMPTFRAME_PUBLIC_RESOURCE_POLICY,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
  PROMPTFRAME_PUBLIC_STANDARD_POLICY,
  PROMPTFRAME_CONTRACTS_VERSION,
  PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY,
  detectPromptFrameUnknownCustomStyleProps,
  evaluatePromptFrameDependencyPolicy,
  authoringUploadTargetSchema,
  parseComponentManifest,
  type ComponentManifest,
  type ComponentDiagnostic,
  type ComponentPublicResourceEntry,
  type ComponentPublicResourceKind,
  type AuthoringStandardFreshnessDecision,
  type AuthoringUploadTarget,
  type PublicPolicyRuleId,
  type PromptFrameDependencyPolicyReceipt,
} from '@promptframe/contracts';
import {
  evaluatePromptFrameSecurityPolicySource,
  type PromptFrameSecurityPolicyFinding,
} from '@promptframe/contracts/security-evaluator';
import {
  applyPackageChanges,
  buildFreshnessDecision,
  computePackageChanges,
  computePackageFreshnessDiagnostics,
  resolveLocalPreviewScript,
  type ComponentPackageJson,
  type PackageFreshnessDiagnostic,
} from './lifecycle.js';
import {
  evaluateLocalReusability,
  reusabilityDiagnostics,
  type LocalReusabilityDiagnostic,
} from './reusability.js';
import {
  assertPreviewEnvelope,
  writeLocalPreviewReport,
} from './preview-report.js';

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

const REQUIRED_COMPONENT_FILES = PROMPTFRAME_PUBLIC_STANDARD_POLICY.requiredFiles;
const CLI_AUTH_CONTRACT_VERSION = 'cli-auth.v0.1.0';
const DEFAULT_CLI_LOGIN_SCOPES = ['component.upload', 'component.status.read'];
const SECURITY_EVALUATOR_MODE = 'ast';
const LOCKFILE_EVIDENCE_SCHEMA_VERSION = 'promptframe.lockfile-evidence.v0.1.0';
const LOCKFILE_EVIDENCE_FILE_NAME = 'promptframe-lockfile-evidence.json';
const PACKAGE_MANAGER_LOCKFILE_NAMES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
] as const;
const PACKAGE_MANAGER_LOCKFILE_NAME_SET = new Set<string>(PACKAGE_MANAGER_LOCKFILE_NAMES);

const VALIDATE_CHECKED_RULE_IDS: PublicPolicyRuleId[] = [
  'manifest.identity.version',
  'manifest.component_type.supported',
  'evidence.schema_source_hash_present',
  'runtime.deterministic.remotion',
  'runtime.deterministic.fps_hardcoded_timing',
  'security.forbidden.browser_apis',
  'security.no_raw_remote_url_import',
  'package.no_parent_imports',
  'component.style.unknown_custom_style_prop',
];

type PublicResourceReportStatus = 'empty' | 'accepted' | 'blocked';

interface PublicResourceReport {
  contractVersion: typeof COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION;
  policyVersion: typeof PROMPTFRAME_PUBLIC_RESOURCE_POLICY.policyVersion;
  sourceDirectory: 'public';
  status: PublicResourceReportStatus;
  total: number;
  totalBytes: number;
  entries: ComponentPublicResourceEntry[];
  diagnostics: ComponentDiagnostic[];
}

interface ComponentPackageArtifact {
  out: string;
  sizeBytes: number;
  sha256: string;
  publicResources?: PublicResourceReport;
}

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
    case 'check':
      await check(argv);
      break;
    case 'upgrade':
      upgrade(argv);
      break;
    case 'preview':
      preview(argv);
      break;
    case 'dev':
      await dev(argv);
      break;
    case 'login':
      await login(argv);
      break;
    case 'whoami':
      await whoami(argv);
      break;
    case 'logout':
      await logout(argv);
      break;
    case 'setup-ci':
      setupCi(argv);
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
  const target = 'marketplace_authoring';
  printJson({
    command: 'standard',
    contractsVersion: PROMPTFRAME_CONTRACTS_VERSION,
    manifestSchemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    componentStandardVersion: COMPONENT_STANDARD_VERSION,
    standardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    componentRefVersion: COMPONENT_REF_VERSION,
    supportedComponentTypes: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.supportedComponentTypes,
    standardPolicyVersion: PROMPTFRAME_PUBLIC_STANDARD_POLICY.policyVersion,
    securityPolicyVersion: PROMPTFRAME_PUBLIC_SECURITY_POLICY.policyVersion,
    publicResourcePolicyVersion: PROMPTFRAME_PUBLIC_RESOURCE_POLICY.policyVersion,
    publicResourcePolicy: PROMPTFRAME_PUBLIC_RESOURCE_POLICY,
    dependencyPolicyVersion: PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY.policyVersion,
    dependencyPolicy: PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY,
    previewLimits: PROMPTFRAME_PUBLIC_STANDARD_POLICY.previewLimits,
    authoringStandardRelease: PROMPTFRAME_AUTHORING_STANDARD_RELEASE,
    securityPolicyDigest: PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    securityEvaluatorMode: SECURITY_EVALUATOR_MODE,
    freshness: buildFreshnessDecision(
      target,
      diagnostic('standard.freshness.current', 'info', 'Local authoring standard matches the current public release.'),
    ),
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
  const publicResources = evaluateDirectoryPublicResources(dir);
  assertPublicResourcesAccepted(publicResources);
  const dependencyPolicy = evaluateDirectoryDependencyPolicy(dir);
  const diagnostics = [
    ...stylePropDiagnostics(dir),
    ...securityPolicyWarningDiagnostics(dir),
    ...dependencyPolicy.diagnostics,
    ...publicResources.diagnostics,
  ];
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
    securityPolicyVersion: PROMPTFRAME_PUBLIC_SECURITY_POLICY.policyVersion,
    securityPolicyDigest: PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    securityEvaluatorMode: SECURITY_EVALUATOR_MODE,
    dependencyPolicy,
    publicResources,
    diagnostics,
    diagnostic: diagnostic('validate.completed', 'info', 'Component manifest and public source boundaries validated.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`validate passed: ${dir}`);
  printDiagnostics(diagnostics);
}

async function check(argv: string[]): Promise<void> {
  const dir = resolve(firstPositionalArg(argv) ?? '.');
  const target = resolveUploadTarget(argv);
  const manifest = validateComponentDirectory(dir);
  assertAuthoringPackageFreshness(dir, target);
  const freshness = await resolveSoftRemoteStandardFreshness(argv, target, 'check');
  const localReusability = evaluateDirectoryReusability(dir, manifest, target);
  const dependencyPolicy = evaluateDirectoryDependencyPolicy(dir);
  const publicResources = evaluateDirectoryPublicResources(dir);
  assertPublicResourcesAccepted(publicResources);
  const diagnostics = [
    ...reusabilityDiagnostics(localReusability),
    ...stylePropDiagnostics(dir),
    ...securityPolicyWarningDiagnostics(dir),
    ...dependencyPolicy.diagnostics,
    ...publicResources.diagnostics,
  ];
  const output = {
    command: 'check',
    dir,
    manifest: manifestSummary(manifest),
    checkedRuleIds: VALIDATE_CHECKED_RULE_IDS,
    securityPolicyVersion: PROMPTFRAME_PUBLIC_SECURITY_POLICY.policyVersion,
    securityPolicyDigest: PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    securityEvaluatorMode: SECURITY_EVALUATOR_MODE,
    freshness,
    localReusability,
    dependencyPolicy,
    publicResources,
    diagnostics,
    diagnostic: diagnostic('check.completed', 'info', 'Component authoring checks completed.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`check passed: ${dir}`);
  console.log(`Target: ${target}`);
  console.log(`Freshness: ${output.freshness.status}`);
  printDiagnostics(diagnostics);
}

function upgrade(argv: string[]): void {
  const dir = resolve(firstPositionalArg(argv) ?? '.');
  if (hasFlag(argv, '--apply') && hasFlag(argv, '--dry-run')) {
    fail('upgrade accepts either --apply or --dry-run, not both.', 'upgrade.mode.conflict', 2);
  }
  const apply = hasFlag(argv, '--apply');
  const packagePath = join(dir, 'package.json');
  const packageJson = readPackageManifest(packagePath);
  const packageChanges = computePackageChanges(packageJson);

  if (apply && packageChanges.length > 0) {
    const nextPackageJson = applyPackageChanges(packageJson, packageChanges);
    writeFileSync(packagePath, `${JSON.stringify(nextPackageJson, null, 2)}\n`, 'utf8');
  }

  const output = {
    command: 'upgrade',
    dir,
    apply,
    packageChanges,
    diagnostic: diagnostic(
      apply ? 'upgrade.applied' : 'upgrade.dry_run',
      'info',
      apply
        ? 'PromptFrame authoring package floors were updated.'
        : 'PromptFrame authoring package floor changes were computed without writing files.',
    ),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(apply ? `upgrade applied: ${dir}` : `upgrade dry-run: ${dir}`);
  for (const change of packageChanges) {
    console.log(`${change.dependencySet} ${change.name}: ${change.current ?? '<missing>'} -> ${change.next}`);
  }
}

function preview(argv: string[]): void {
  const dir = resolve(firstPositionalArg(argv) ?? '.');
  const manifest = validateComponentDirectory(dir);
  const previewEnvelope = readPreviewProps(dir);
  const previewScript = resolveLocalPreviewScript(readPackageManifest(join(dir, 'package.json')));
  const localPreviewReport = hasFlag(argv, '--write-local-report')
    ? writeLocalPreviewReport({
      dir,
      component: manifestSummary(manifest),
      canonicalPreview: previewEnvelope,
      fail,
    })
    : undefined;
  const output = {
    command: 'preview',
    dir,
    manifest: manifestSummary(manifest),
    renderingSystem: 'remotion',
    previewSource: 'src/preview-props.json',
    preview: previewEnvelope,
    localDevCommand: ['npm', 'run', previewScript],
    localPreviewReport,
    diagnostic: diagnostic('preview.ready', 'info', 'Local Remotion preview envelope is ready.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`preview ready: ${dir}`);
  console.log(`Rendering system: ${output.renderingSystem}`);
  console.log(`Preview: ${previewEnvelope.width}x${previewEnvelope.height} @ ${previewEnvelope.fps}fps, ${previewEnvelope.durationFrames} frames`);
  if (localPreviewReport) console.log(`Local preview report: ${localPreviewReport.path}`);
  console.log(`Run: npm run ${previewScript}`);
}

async function dev(argv: string[]): Promise<void> {
  const dir = resolve(firstPositionalArg(argv) ?? '.');
  const target = resolveUploadTarget(argv);
  const manifest = validateComponentDirectory(dir);
  assertAuthoringPackageFreshness(dir, target);
  const freshness = await resolveSoftRemoteStandardFreshness(argv, target, 'dev');
  const previewEnvelope = readPreviewProps(dir);
  const host = valueAfter(argv, '--host') ?? '127.0.0.1';
  const port = parsePort(valueAfter(argv, '--port') ?? '5173');
  const devScript = resolveLocalPreviewScript(readPackageManifest(join(dir, 'package.json')));
  const devCommand = ['npm', 'run', devScript, '--', '--host', host, '--port', String(port)];
  const output = {
    command: 'dev',
    dir,
    manifest: manifestSummary(manifest),
    renderingSystem: 'remotion-player',
    previewSource: 'src/preview-props.json',
    preview: previewEnvelope,
    freshness,
    devServer: {
      url: `http://${host}:${port}`,
      command: devCommand,
    },
    diagnostic: diagnostic('dev.ready', 'info', 'Local Remotion Player preview command is ready.'),
  };

  if (hasFlag(argv, '--json')) {
    if (!hasFlag(argv, '--dry-run')) {
      fail('dev --json requires --dry-run so stdout remains machine-readable.', 'dev.json_requires_dry_run');
    }
    printJson(output);
    return;
  }

  console.log(`dev ready: ${dir}`);
  console.log(`Rendering system: ${output.renderingSystem}`);
  console.log(`Preview URL: ${output.devServer.url}`);
  console.log(`Freshness: ${freshness.status}`);
  console.log(`Command: ${devCommand.join(' ')}`);
  if (hasFlag(argv, '--dry-run')) return;

  await runDevServer(dir, devCommand);
}

function packageComponent(argv: string[]): void {
  const artifact = packageDirectory(argv[0] ?? '.', valueAfter(argv, '--out'));
  printJson({
    command: 'package',
    diagnostic: diagnostic('package.completed', 'info', 'Component source archive created.'),
    out: artifact.out,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    publicResources: artifact.publicResources,
  });
}

function validateComponentDirectory(dir: string): ComponentManifest {
  assertRequiredFiles(dir);
  assertDependencyPolicyAccepted(evaluateDirectoryDependencyPolicy(dir));
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const parsed = parseComponentManifest(normalizeLegacyManifest(manifest));
  validatePreviewProps(dir);
  validateSourceSafety(dir);
  validateSecurityPolicy(dir);
  checkImportBoundary(dir);
  return parsed;
}

function manifestSummary(manifest: ComponentManifest): Record<string, string | undefined> {
  return {
    id: manifest.id,
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    componentType: manifest.componentType ?? manifest.layer,
  };
}

function readPackageManifest(path: string): ComponentPackageJson {
  if (!existsSync(path)) {
    fail('package.json is required before running upgrade.', 'upgrade.package_json.missing');
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ComponentPackageJson;
  } catch {
    fail('package.json must be valid JSON before running upgrade.', 'upgrade.package_json.invalid');
  }
}

function evaluateDirectoryDependencyPolicy(dir: string): PromptFrameDependencyPolicyReceipt {
  return evaluatePromptFrameDependencyPolicy({
    packageJson: readPackageManifest(join(dir, 'package.json')),
    lockfilePresent: hasPackageManagerLockfile(dir),
  });
}

function hasPackageManagerLockfile(dir: string): boolean {
  return [
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ].some((fileName) => existsSync(join(dir, fileName)));
}

function assertDependencyPolicyAccepted(receipt: PromptFrameDependencyPolicyReceipt): void {
  if (receipt.status !== 'reject') return;
  const first = receipt.diagnostics[0];
  fail(
    first?.message ?? 'PromptFrame dependency policy rejected this component package.',
    first?.code ?? 'dependency.policy.rejected',
  );
}

function packageDirectory(componentDir: string, outArg?: string): ComponentPackageArtifact {
  const dir = resolve(componentDir);
  const manifest = validateComponentDirectory(dir);
  const publicResources = evaluateDirectoryPublicResources(dir);
  assertPublicResourcesAccepted(publicResources);
  const out = resolve(outArg ?? join(dir, '.component-packages', `${manifest.name}.zip`));
  const files = collectPackageFiles(dir);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildStoredZip(files));
  const sizeBytes = statSync(out).size;
  const sha256 = `sha256:${createHash('sha256').update(readFileSync(out)).digest('hex')}`;
  return { out, sizeBytes, sha256, publicResources };
}

function packageDirectoryForUploadWithLocalReusability(
  componentDir: string,
  uploadTarget: AuthoringUploadTarget,
  outArg: string | undefined,
  onReusability: (reusability: ReturnType<typeof evaluateDirectoryReusability>) => void,
): ComponentPackageArtifact {
  const dir = resolve(componentDir);
  const manifest = validateComponentDirectory(dir);
  assertAuthoringPackageFreshness(dir, uploadTarget);
  onReusability(evaluateDirectoryReusability(dir, manifest, uploadTarget));
  return packageDirectory(dir, outArg);
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
  const uploadTarget = resolveUploadTarget(argv);
  let localReusability: ReturnType<typeof evaluateDirectoryReusability> | undefined;
  const artifact = target.endsWith('.zip')
    ? packageZipForUpload(target, uploadTarget)
    : packageDirectoryForUploadWithLocalReusability(
        target,
        uploadTarget,
        valueAfter(argv, '--out'),
        (reusability) => {
          localReusability = reusability;
        },
      );
  const localDiagnostics = localReusability
    ? [
        ...reusabilityDiagnostics(localReusability),
        ...stylePropDiagnostics(target),
        ...(artifact.publicResources?.diagnostics ?? []),
      ]
    : undefined;
  const endpoint = resolveEndpoint('upload', argv);
  await assertRemoteStandardFreshness(endpoint, argv);
  const file = readFileSync(artifact.out);
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)], { type: 'application/zip' }), basename(artifact.out));
  const payload = await fetchJson(`${endpoint}/components/marketplace/upload`, {
    method: 'POST',
    body: form,
    headers: {
      ...buildRemoteHeaders(endpoint, argv),
      ...buildSecurityPolicyHeaders(),
      'x-promptframe-upload-target': uploadTarget,
    },
  }, 'upload.http.failed');
  const output = {
    ...payload,
    command: 'upload',
    endpoint,
    uploadTarget,
    jobId: getBuildId(payload),
    package: artifact,
    ...(localReusability ? { localReusability, diagnostics: localDiagnostics } : {}),
    diagnostic: diagnostic('upload.completed', 'info', 'Component upload accepted by platform.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log('Upload accepted by PromptFrame platform.');
  console.log(`Build: ${output.jobId ?? 'unknown'}`);
  console.log(`Status: ${stringValue(payload.status) ?? stringValue(asRecord(payload.build)?.status) ?? 'queued'}`);
  if (localDiagnostics) printDiagnostics(localDiagnostics);
  printStatusUrl(endpoint, payload);
}

function resolveUploadTarget(argv: string[]): AuthoringUploadTarget {
  const raw = normalizeUploadTargetAlias(
    valueAfter(argv, '--target') ?? valueAfter(argv, '--upload-target') ?? 'marketplace_authoring',
  );
  const parsed = authoringUploadTargetSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`Unknown component upload target: ${raw}.`, 'upload.target.invalid');
  }
  return parsed.data;
}

function normalizeUploadTargetAlias(raw: string): string {
  if (raw === 'marketplace') return 'marketplace_authoring';
  if (raw === 'project_private') return 'project_private_generation';
  return raw;
}

function assertAuthoringPackageFreshness(dir: string, target: AuthoringUploadTarget): void {
  const diagnostics = computePackageFreshnessDiagnostics(readPackageManifest(join(dir, 'package.json')), target);
  if (diagnostics.length === 0) return;
  fail(formatPackageFreshnessFailure(diagnostics, target), diagnostics[0]!.code);
}

function assertAuthoringZipPackageFreshness(path: string, target: AuthoringUploadTarget): void {
  const packageJson = readPackageManifestFromZip(path);
  const diagnostics = computePackageFreshnessDiagnostics(packageJson, target);
  if (diagnostics.length === 0) return;
  fail(formatPackageFreshnessFailure(diagnostics, target), diagnostics[0]!.code);
}

async function assertRemoteStandardFreshness(endpoint: string, argv: string[]): Promise<void> {
  const payload = await fetchJson(`${endpoint}/components/standard`, {
    headers: buildRemoteHeaders(endpoint, argv),
  }, 'standard.freshness.fetch_failed');
  const remoteSourceHash = extractRemoteStandardSourceHash(payload);
  if (!remoteSourceHash) {
    fail('PromptFrame standard endpoint did not return a sourceHash.', 'standard.freshness.remote_invalid');
  }
  if (remoteSourceHash !== COMPONENT_STANDARD_SOURCE_HASH) {
    fail(formatRemoteStandardStaleFailure(remoteSourceHash), 'standard.freshness.upload_blocking');
  }
}

async function resolveSoftRemoteStandardFreshness(
  argv: string[],
  target: AuthoringUploadTarget,
  commandName: 'check' | 'dev',
): Promise<AuthoringStandardFreshnessDecision> {
  const endpoint = resolveOptionalEndpoint(argv);
  if (!endpoint) {
    return buildFreshnessWarningDecision(
      target,
      'standard.freshness.offline_degraded',
      `${commandName} ran local policy and package checks without a platform endpoint; online standard sourceHash freshness was skipped.`,
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = await fetchJson(`${endpoint}/components/standard`, {
      headers: buildRemoteHeaders(endpoint, argv, { requireAuth: false }),
    }, 'standard.freshness.fetch_failed');
  } catch {
    return buildFreshnessWarningDecision(
      target,
      'standard.freshness.offline_degraded',
      `${commandName} could not reach the platform standard endpoint; local checks passed but online sourceHash freshness is degraded.`,
    );
  }
  const remoteSourceHash = extractRemoteStandardSourceHash(payload);
  if (!remoteSourceHash) {
    return buildFreshnessWarningDecision(
      target,
      'standard.freshness.offline_degraded',
      `${commandName} platform standard response did not include sourceHash; local checks passed but online freshness is degraded.`,
    );
  }
  if (remoteSourceHash !== COMPONENT_STANDARD_SOURCE_HASH) {
    fail(formatRemoteStandardStaleFailure(remoteSourceHash), 'standard.freshness.upload_blocking');
  }
  return buildFreshnessDecision(
    target,
    diagnostic('standard.freshness.current', 'info', 'Local authoring standard matches the platform source hash.'),
  );
}

function buildFreshnessWarningDecision(
  target: AuthoringUploadTarget,
  code: string,
  message: string,
): AuthoringStandardFreshnessDecision {
  return {
    status: 'warning',
    target,
    localStandardVersion: COMPONENT_STANDARD_VERSION,
    localStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    currentStandardVersion: COMPONENT_STANDARD_VERSION,
    currentStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    minPackageVersions: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions,
    diagnostic: diagnostic(code, 'warning', message),
    retryable: true,
  };
}

function formatRemoteStandardStaleFailure(remoteSourceHash: string): string {
  return `PromptFrame component standard is stale: local=${COMPONENT_STANDARD_SOURCE_HASH}, platform=${remoteSourceHash}. Run promptframe upgrade . --apply before upload.`;
}

function extractRemoteStandardSourceHash(payload: Record<string, unknown>): string | undefined {
  return stringValue(payload.sourceHash)
    ?? stringValue(payload.standardSourceHash)
    ?? stringValue(asRecord(payload.standard)?.sourceHash)
    ?? stringValue(asRecord(payload.authoringStandardRelease)?.standardSourceHash);
}

async function showStatus(argv: string[]): Promise<void> {
  const buildId = requiredArg(argv[0], 'status requires a build id', 'status.build_id.missing');
  const endpoint = resolveEndpoint('status', argv);
  const payload = await fetchJson(`${endpoint}/components/marketplace/builds/${encodeURIComponent(buildId)}`, {
    headers: buildRemoteHeaders(endpoint, argv),
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
      ...buildRemoteHeaders(endpoint, argv),
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
      ...buildRemoteHeaders(endpoint, argv),
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

async function login(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('login', argv);
  const tokenSecret = valueAfter(argv, '--token')
    ?? process.env.PROMPTFRAME_CLI_TOKEN
    ?? process.env.PROMPTFRAME_CI_TOKEN;
  if (!tokenSecret) {
    await loginWithDeviceCode(endpoint, argv);
    return;
  }
  const whoamiPayload = await fetchJson(`${endpoint}/cli/auth/whoami`, {
    headers: {
      authorization: `Bearer ${tokenSecret}`,
    },
  }, 'login.http.failed');
  const credential = buildStoredCredential(endpoint, tokenSecret, whoamiPayload);
  const current = readConfig(argv);
  writeConfig(argv, {
    ...current,
    endpoint,
    tenantId: credential.tenantId,
    projectId: credential.projectId,
    credential,
  });
  const output = {
    command: 'login',
    endpoint,
    credential: redactCredential(credential),
    storage: fileCredentialWarning(),
    diagnostic: diagnostic('login.completed', 'info', 'PromptFrame CLI credential stored locally.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Logged in to ${endpoint}.`);
  if (credential.displayIdentifier) console.log(`User: ${credential.displayIdentifier}`);
  console.log('Credential stored in local PromptFrame config with file permissions restricted to the current OS user.');
}

async function loginWithDeviceCode(endpoint: string, argv: string[]): Promise<void> {
  const startPayload = await fetchJson(`${endpoint}/cli/auth/device/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion: CLI_AUTH_CONTRACT_VERSION,
      endpoint,
      clientName: `PromptFrame CLI on ${os.hostname()}`,
      requestedScopes: DEFAULT_CLI_LOGIN_SCOPES,
    }),
  }, 'login.device_start.failed');
  const deviceCode = requiredPayloadString(startPayload, 'deviceCode', 'login.device_start.invalid');
  const device = redactDeviceStart(startPayload);
  if (!hasFlag(argv, '--json')) {
    console.log('Open this PromptFrame login URL in your browser:');
    console.log(`  ${device.verificationUriComplete ?? device.verificationUri}`);
    if (device.userCode) console.log(`Code: ${device.userCode}`);
    console.log('Waiting for browser approval...');
  }
  const credential = await pollDeviceCredential(endpoint, deviceCode, startPayload, argv);
  const current = readConfig(argv);
  writeConfig(argv, {
    ...current,
    endpoint,
    tenantId: credential.tenantId,
    projectId: credential.projectId,
    credential,
  });
  const output = {
    command: 'login',
    endpoint,
    device,
    credential: redactCredential(credential),
    storage: fileCredentialWarning(),
    diagnostic: diagnostic('login.completed', 'info', 'PromptFrame CLI credential stored locally.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Logged in to ${endpoint}.`);
  if (credential.displayIdentifier) console.log(`User: ${credential.displayIdentifier}`);
  console.log('Credential stored in local PromptFrame config with file permissions restricted to the current OS user.');
}

async function pollDeviceCredential(
  endpoint: string,
  deviceCode: string,
  startPayload: Record<string, unknown>,
  argv: string[],
): Promise<Record<string, string>> {
  const intervalSeconds = parsePositiveSeconds(
    valueAfter(argv, '--poll-interval-seconds'),
    '--poll-interval-seconds',
    parsePositiveSeconds(startPayload.intervalSeconds, 'intervalSeconds', 5),
  );
  const timeoutSeconds = parsePositiveSeconds(valueAfter(argv, '--timeout-seconds'), '--timeout-seconds', 600);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    const pollPayload = await fetchJson(`${endpoint}/cli/auth/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: CLI_AUTH_CONTRACT_VERSION,
        deviceCode,
      }),
    }, 'login.device_poll.failed');
    const status = stringValue(pollPayload.status);
    if (status === 'approved') return buildStoredCredentialFromDevice(endpoint, pollPayload);
    if (status === 'pending') {
      await sleep(intervalSeconds * 1000);
      continue;
    }
    const remoteDiagnostic = asRecord(pollPayload.diagnostic);
    fail(
      stringValue(remoteDiagnostic?.message) ?? `PromptFrame browser login ended with status ${status ?? 'unknown'}.`,
      stringValue(remoteDiagnostic?.code) ?? 'cli.auth.device_failed',
      2,
    );
  }
  fail('PromptFrame browser login timed out before approval.', 'cli.auth.device_timeout', 2);
}

async function whoami(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('whoami', argv);
  const tokenSecret = resolveBearerToken(endpoint, argv);
  if (!tokenSecret) {
    fail(
      'No PromptFrame CLI credential found for this endpoint. Run promptframe login --endpoint <url> or provide PROMPTFRAME_CI_TOKEN.',
      'cli.auth.login_required',
      2,
    );
  }
  const payload = await fetchJson(`${endpoint}/cli/auth/whoami`, {
    headers: {
      authorization: `Bearer ${tokenSecret}`,
    },
  }, 'whoami.http.failed');
  const output = {
    ...payload,
    command: 'whoami',
    endpoint,
    diagnostic: diagnostic('whoami.completed', 'info', 'PromptFrame CLI identity fetched.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  const principal = asRecord(payload.principal);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Token: ${stringValue(payload.tokenKind) ?? 'unknown'} ${stringValue(payload.tokenId) ?? ''}`.trim());
  console.log(`Tenant: ${stringValue(principal?.tenantId) ?? 'unknown'}`);
  console.log(`Project: ${stringValue(principal?.projectId) ?? '<none>'}`);
  console.log(`User: ${stringValue(principal?.displayIdentifier) ?? stringValue(principal?.email) ?? stringValue(principal?.userId) ?? 'unknown'}`);
}

async function logout(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('logout', argv);
  const tokenSecret = resolveBearerToken(endpoint, argv);
  if (!tokenSecret) {
    fail(
      'No PromptFrame CLI credential found for this endpoint. Nothing was revoked.',
      'cli.auth.login_required',
      2,
    );
  }
  const payload = await fetchJson(`${endpoint}/cli/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenSecret}`,
    },
  }, 'logout.http.failed');
  const clearedLocalCredential = clearStoredCredential(endpoint, tokenSecret, argv);
  const output = {
    ...payload,
    command: 'logout',
    endpoint,
    clearedLocalCredential,
    diagnostic: diagnostic('logout.completed', 'info', 'PromptFrame CLI credential revoked.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Logged out from ${endpoint}.`);
  console.log(clearedLocalCredential ? 'Local credential cleared.' : 'No matching local credential was stored.');
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

function setupCi(argv: string[]): void {
  const provider = valueAfter(argv, '--provider') ?? 'github';
  if (provider !== 'github') {
    fail(`Unsupported CI provider: ${provider}.`, 'setup_ci.provider.unsupported', 2);
  }
  const targetDir = resolve(setupCiTargetDir(argv));
  const workflowPath = join(targetDir, '.github', 'workflows', 'promptframe-component.yml');
  if (existsSync(workflowPath) && !hasFlag(argv, '--force')) {
    fail(
      `PromptFrame GitHub workflow already exists at ${workflowPath}. Use --force to overwrite.`,
      'setup_ci.workflow.exists',
    );
  }
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, promptFrameGithubWorkflow(), 'utf8');
  const output = {
    success: true,
    command: 'setup-ci',
    provider,
    workflowPath,
    requiredSecrets: ['PROMPTFRAME_CI_TOKEN'],
    requiredVariables: ['PROMPTFRAME_API_BASE'],
    pullRequestMode: 'check_only',
    pushMode: 'upload',
    diagnostic: diagnostic('setup_ci.github.completed', 'info', 'PromptFrame GitHub Actions workflow written.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Wrote PromptFrame GitHub workflow: ${workflowPath}`);
  console.log('Add repository secret PROMPTFRAME_CI_TOKEN and variable PROMPTFRAME_API_BASE before enabling upload on main/release.');
}

function setupCiTargetDir(argv: string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && ['--provider', '--config'].includes(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return '.';
}

function promptFrameGithubWorkflow(): string {
  const apiBaseVariable = '$' + '{{ vars.PROMPTFRAME_API_BASE }}';
  const ciTokenSecret = '$' + '{{ secrets.PROMPTFRAME_CI_TOKEN }}';
  return `name: PromptFrame Component

on:
  pull_request:
  push:
    branches: [main]
    tags:
      - 'v*'
      - 'component-*'

permissions:
  contents: read

jobs:
  check:
    name: PromptFrame check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm install
      - name: Validate component package
        env:
          PROMPTFRAME_API_BASE: ${apiBaseVariable}
        run: |
          set +e
          npx promptframe check . --json > promptframe-check.json
          CHECK_EXIT=$?
          set -e
          node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-check.json', 'utf8'));
          const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
          for (const item of diagnostics) {
            const code = String(item.code || 'promptframe.diagnostic');
            const message = String(item.message || code).replace(/\\r?\\n/g, ' ');
            if (item.severity === 'error') {
              console.log(\`::error title=\${code}::\${message}\`);
            } else {
              console.log(\`::warning title=\${code}::\${message}\`);
            }
          }
          const summary = process.env.GITHUB_STEP_SUMMARY;
          if (summary) {
            fs.appendFileSync(summary, [
              '### PromptFrame check',
              '',
              \`- Diagnostic: \\\`\${payload.diagnostic?.code || 'unknown'}\\\`\`,
              \`- Freshness: \\\`\${payload.freshness?.status || 'unknown'}\\\`\`,
              \`- Diagnostics: \\\`\${diagnostics.length}\\\`\`,
              '',
            ].join('\\n'));
          }
          NODE
          exit "$CHECK_EXIT"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: promptframe-check-report
          path: promptframe-check.json

  upload:
    name: PromptFrame upload
    if: github.event_name == 'push'
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm install
      - name: Upload component to PromptFrame
        env:
          PROMPTFRAME_API_BASE: ${apiBaseVariable}
          PROMPTFRAME_CI_TOKEN: ${ciTokenSecret}
        run: |
          set -euo pipefail
          npx promptframe upload . --endpoint "$PROMPTFRAME_API_BASE" --json | tee promptframe-upload.json
          BUILD_ID=$(node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-upload.json', 'utf8'));
          process.stdout.write(String(payload.jobId || payload.buildId || payload.build?.buildId || ''));
          NODE
          )
          if [ -z "$BUILD_ID" ]; then
            echo "PromptFrame upload response did not include a build id." >&2
            exit 1
          fi
          npx promptframe status "$BUILD_ID" --endpoint "$PROMPTFRAME_API_BASE" --json | tee promptframe-status.json
          node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-upload.json', 'utf8'));
          const status = JSON.parse(fs.readFileSync('promptframe-status.json', 'utf8'));
          const summary = process.env.GITHUB_STEP_SUMMARY;
          if (summary) {
            fs.appendFileSync(summary, [
              '### PromptFrame upload',
              '',
              \`- Diagnostic: \\\`\${payload.diagnostic?.code || 'unknown'}\\\`\`,
              \`- Build ID: \\\`\${payload.jobId || payload.buildId || 'unknown'}\\\`\`,
              \`- Admission status: \\\`\${status.build?.status || status.status || payload.status || 'queued'}\\\`\`,
              '',
            ].join('\\n'));
          }
          NODE
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: promptframe-upload-report
          path: |
            promptframe-upload.json
            promptframe-status.json
`;
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

function resolveOptionalEndpoint(argv: string[]): string | undefined {
  const config = readConfig(argv);
  const endpoint = valueAfter(argv, '--endpoint')
    ?? stringValue(process.env.PROMPTFRAME_API_BASE)
    ?? stringValue(process.env.REMOTION_MEDIA_API_BASE)
    ?? stringValue(config.endpoint);
  return endpoint ? normalizeEndpoint(endpoint) : undefined;
}

function buildContextHeaders(argv: string[]): Record<string, string> {
  const config = readConfig(argv);
  return compactRecord({
    'x-tenant-id': valueAfter(argv, '--tenant-id') ?? stringValue(config.tenantId),
    'x-user-id': valueAfter(argv, '--user-id') ?? stringValue(config.userId),
    'x-project-id': valueAfter(argv, '--project-id') ?? stringValue(config.projectId),
    'x-session-id': valueAfter(argv, '--session-id') ?? stringValue(config.sessionId),
    'x-auth-roles': valueAfter(argv, '--auth-roles') ?? stringValue(process.env.PROMPTFRAME_AUTH_ROLES) ?? stringValue(config.authRoles),
    'x-auth-permissions': valueAfter(argv, '--auth-permissions') ?? stringValue(process.env.PROMPTFRAME_AUTH_PERMISSIONS) ?? stringValue(config.authPermissions),
  });
}

function buildRemoteHeaders(
  endpoint: string,
  argv: string[],
  options: { requireAuth?: boolean } = {},
): Record<string, string> {
  const bearerToken = resolveBearerToken(endpoint, argv);
  if (bearerToken) {
    return {
      authorization: `Bearer ${bearerToken}`,
    };
  }
  const contextHeaders = buildContextHeaders(argv);
  const hasDevHeaders = Object.keys(contextHeaders).some((name) => [
    'x-tenant-id',
    'x-user-id',
    'x-auth-roles',
    'x-auth-permissions',
  ].includes(name));
  if (isFormalEndpoint(endpoint) && hasDevHeaders) {
    fail(
      'Formal PromptFrame endpoints do not accept dev identity headers. Use promptframe login or a scoped CI token.',
      'cli.auth.dev_header_formal_endpoint_forbidden',
    );
  }
  if (isFormalEndpoint(endpoint) && options.requireAuth !== false) {
    fail(
      'No PromptFrame CLI credential found for this endpoint. Run promptframe login --endpoint <url> or provide PROMPTFRAME_CI_TOKEN.',
      'cli.auth.login_required',
      2,
    );
  }
  return contextHeaders;
}

function buildSecurityPolicyHeaders(): Record<string, string> {
  return {
    'x-promptframe-security-policy-version': PROMPTFRAME_PUBLIC_SECURITY_POLICY.policyVersion,
    'x-promptframe-security-policy-digest': PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    'x-promptframe-security-evaluator-mode': SECURITY_EVALUATOR_MODE,
  };
}

function resolveBearerToken(endpoint: string, argv: string[]): string | undefined {
  const explicit = valueAfter(argv, '--token')
    ?? process.env.PROMPTFRAME_CI_TOKEN
    ?? process.env.PROMPTFRAME_CLI_TOKEN
    ?? process.env.PROMPTFRAME_AUTH_TOKEN;
  if (explicit) return explicit;
  const credential = asRecord(readConfig(argv).credential);
  if (!credential) return undefined;
  if (normalizeEndpoint(stringValue(credential.endpoint) ?? '') !== normalizeEndpoint(endpoint)) return undefined;
  const expiresAt = stringValue(credential.expiresAt);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    fail('Stored PromptFrame CLI credential is expired. Run promptframe login again.', 'cli.auth.token_expired', 2);
  }
  return stringValue(credential.tokenSecret);
}

function buildStoredCredential(
  endpoint: string,
  tokenSecret: string,
  whoamiPayload: Record<string, unknown>,
): Record<string, string> {
  const principal = asRecord(whoamiPayload.principal);
  return compactRecord({
    contractVersion: stringValue(whoamiPayload.contractVersion) ?? 'cli-auth.v0.1.0',
    endpoint,
    tokenId: stringValue(whoamiPayload.tokenId),
    tokenKind: stringValue(whoamiPayload.tokenKind) ?? 'human',
    displayIdentifier: stringValue(principal?.displayIdentifier) ?? stringValue(principal?.email),
    tenantId: stringValue(principal?.tenantId),
    projectId: stringValue(principal?.projectId),
    expiresAt: stringValue(whoamiPayload.expiresAt),
    tokenSecret,
  });
}

function buildStoredCredentialFromDevice(
  endpoint: string,
  payload: Record<string, unknown>,
): Record<string, string> {
  const credential = asRecord(payload.credential);
  if (!credential) {
    fail('PromptFrame browser login approval did not include a credential.', 'cli.auth.device_credential_missing', 2);
  }
  const tokenSecret = stringValue(credential.tokenSecret);
  if (!tokenSecret) {
    fail('PromptFrame browser login approval did not include a token secret.', 'cli.auth.device_credential_missing', 2);
  }
  return compactRecord({
    contractVersion: stringValue(credential.contractVersion) ?? CLI_AUTH_CONTRACT_VERSION,
    endpoint: stringValue(credential.endpoint) ?? endpoint,
    tokenId: stringValue(credential.tokenId),
    tokenKind: stringValue(credential.tokenKind) ?? 'human',
    displayIdentifier: stringValue(credential.displayIdentifier),
    tenantId: stringValue(credential.tenantId),
    projectId: stringValue(credential.projectId),
    expiresAt: stringValue(credential.expiresAt),
    tokenSecret,
  });
}

function redactCredential(credential: Record<string, unknown>): Record<string, string> {
  return compactRecord({
    contractVersion: stringValue(credential.contractVersion),
    endpoint: stringValue(credential.endpoint),
    tokenId: stringValue(credential.tokenId),
    tokenKind: stringValue(credential.tokenKind),
    displayIdentifier: stringValue(credential.displayIdentifier),
    tenantId: stringValue(credential.tenantId),
    projectId: stringValue(credential.projectId),
    expiresAt: stringValue(credential.expiresAt),
  });
}

function redactDeviceStart(payload: Record<string, unknown>): Record<string, string> {
  return compactRecord({
    contractVersion: stringValue(payload.contractVersion) ?? CLI_AUTH_CONTRACT_VERSION,
    userCode: stringValue(payload.userCode),
    verificationUri: stringValue(payload.verificationUri),
    verificationUriComplete: stringValue(payload.verificationUriComplete),
    expiresAt: stringValue(payload.expiresAt),
  });
}

function clearStoredCredential(endpoint: string, tokenSecret: string, argv: string[]): boolean {
  const current = readConfig(argv);
  const credential = asRecord(current.credential);
  if (
    !credential
    || normalizeEndpoint(stringValue(credential.endpoint) ?? '') !== normalizeEndpoint(endpoint)
    || stringValue(credential.tokenSecret) !== tokenSecret
  ) {
    return false;
  }
  const { credential: _credential, ...rest } = current;
  writeConfig(argv, rest);
  return true;
}

function isFormalEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    return ![
      'localhost',
      '127.0.0.1',
      '::1',
      '0.0.0.0',
    ].includes(hostname);
  } catch {
    return true;
  }
}

function fileCredentialWarning(): Record<string, unknown> {
  return {
    type: 'file',
    diagnostic: diagnostic(
      'cli.auth.file_credential_warning',
      'warning',
      'Credential is stored in the local PromptFrame config file with 0600 permissions. Prefer OS keychain support when available.',
    ),
  };
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
  chmodSync(path, 0o600);
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

function validatePreviewProps(dir: string): void {
  assertPreviewEnvelope(readPreviewProps(dir), 'src/preview-props.json', fail);
}

function readPreviewProps(dir: string): Record<string, unknown> {
  const previewPath = join(dir, 'src/preview-props.json');
  const preview = asRecord(JSON.parse(readFileSync(previewPath, 'utf8')));
  if (!preview) {
    fail('src/preview-props.json must be a JSON object.', 'component_standard.preview.object');
  }
  return preview;
}

function evaluateDirectoryReusability(
  dir: string,
  manifest: ComponentManifest,
  uploadTarget: AuthoringUploadTarget,
): ReturnType<typeof evaluateLocalReusability> {
  return evaluateLocalReusability({
    manifest,
    uploadTarget,
    componentSourceText: readIfExists(join(dir, manifest.entry.sourcePath)),
    schemaSourceText: readIfExists(join(dir, manifest.entry.propsSchemaPath)),
    previewProps: readPreviewProps(dir),
  });
}

function stylePropDiagnostics(dir: string): Array<LocalReusabilityDiagnostic & { propName: string }> {
  return detectPromptFrameUnknownCustomStyleProps(readIfExists(join(dir, 'src/schema.ts')))
    .map((finding) => ({
      code: finding.ruleId,
      severity: finding.severity,
      message: finding.message,
      repairHint: finding.repairHint,
      propName: finding.propName,
    }));
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`Invalid dev port: ${value}`, 'dev.port.invalid');
  }
  return port;
}

function parsePositiveSeconds(value: unknown, flag: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    fail(`Invalid ${flag}: ${String(value)}`, 'cli.duration.invalid', 2);
  }
  return seconds;
}

async function runDevServer(dir: string, commandLine: string[]): Promise<void> {
  const [commandName, ...commandArgs] = commandLine;
  const child = spawn(commandName, commandArgs, {
    cwd: dir,
    stdio: 'inherit',
    env: process.env,
  });
  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });
  if (exitCode !== 0) {
    fail(`Local dev preview exited with code ${exitCode}.`, 'dev.process.failed', exitCode);
  }
}

function validateSourceSafety(dir: string): void {
  for (const entry of collectPackageFiles(dir)) {
    if (!isSourceSafetyScannableFile(entry.name)) continue;
    const source = entry.data.toString('utf8');
    for (const rule of PROMPTFRAME_PUBLIC_STANDARD_POLICY.sourceSafetyRules) {
      const match = source.match(new RegExp(rule.pattern, 'i'));
      if (!match) continue;
      fail(`${entry.name}: ${rule.message} ${rule.repairHint}`, rule.id);
    }
  }
}

function validateSecurityPolicy(dir: string): void {
  for (const entry of collectPackageFiles(dir)) {
    if (!isSecurityScannableFile(entry.name)) continue;
    const source = entry.data.toString('utf8');
    const finding = firstBlockingSecurityFindingFromEvaluator(entry.name, source);
    if (!finding) continue;
    fail(formatSecurityFindingFailure(entry.name, finding), finding.ruleId);
  }
}

function firstBlockingSecurityFindingFromEvaluator(file: string, source: string): PromptFrameSecurityPolicyFinding | undefined {
  const receipt = evaluatePromptFrameSecurityPolicySource({ file, source });
  return receipt.findings.find((finding) => (
    shouldScanSecurityRule(file, finding.ruleId) && finding.action !== 'warn'
  ));
}

function securityPolicyWarningDiagnostics(dir: string): ComponentDiagnostic[] {
  const diagnostics: ComponentDiagnostic[] = [];
  for (const entry of collectPackageFiles(dir)) {
    if (!isSecurityScannableFile(entry.name)) continue;
    const source = entry.data.toString('utf8');
    const receipt = evaluatePromptFrameSecurityPolicySource({ file: entry.name, source });
    for (const finding of receipt.findings) {
      if (finding.action !== 'warn' || !shouldScanSecurityRule(entry.name, finding.ruleId)) continue;
      diagnostics.push(securityPolicyWarningDiagnostic(entry.name, finding));
    }
  }
  return diagnostics;
}

function securityPolicyWarningDiagnostic(
  file: string,
  finding: PromptFrameSecurityPolicyFinding,
): ComponentDiagnostic {
  const location = finding.line && finding.column ? `:${finding.line}:${finding.column}` : '';
  return {
    code: finding.ruleId,
    severity: 'warning',
    stage: 'validate',
    message: `${file}${location}: ${finding.message}`,
    repairHint: finding.repairHint ?? finding.recommendation,
  };
}

function formatSecurityFindingFailure(file: string, finding: PromptFrameSecurityPolicyFinding): string {
  const location = finding.line && finding.column ? `:${finding.line}:${finding.column}` : '';
  const recommendation = finding.recommendation ? ` ${finding.recommendation}` : '';
  return `${file}${location}: ${finding.message}${recommendation} (${finding.detectionKind} security policy; ${finding.policyDigest})`;
}

function shouldScanSecurityRule(file: string, ruleId: string): boolean {
  if (isDocumentationSecurityFile(file)) {
    return ruleId === 'prompt.injection_string' || ruleId === 'network.remote_url';
  }
  if (isPackageManifestSecurityFile(file)) {
    return ruleId === 'package.install_script'
      || ruleId === 'prompt.injection_string'
      || ruleId === 'network.remote_url';
  }
  return true;
}

function isSourceSafetyScannableFile(fileName: string): boolean {
  return /^src\//i.test(fileName)
    && !/\.(test|spec)\.[cm]?(tsx?|jsx?)$/i.test(fileName)
    && /\.(tsx?|jsx?|css)$/i.test(fileName);
}

function isSecurityScannableFile(fileName: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|json|md|mdx)$/i.test(fileName);
}

function isDocumentationSecurityFile(fileName: string): boolean {
  return /\.(md|mdx)$/i.test(fileName);
}

function isPackageManifestSecurityFile(fileName: string): boolean {
  return /(^|\/)package\.json$/i.test(fileName);
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

function packageZipForUpload(path: string, uploadTarget: AuthoringUploadTarget): ComponentPackageArtifact {
  assertAuthoringZipPackageFreshness(path, uploadTarget);
  return packageArtifactFromZip(path);
}

function packageArtifactFromZip(path: string): ComponentPackageArtifact {
  const file = readFileSync(path);
  return {
    out: path,
    sizeBytes: file.byteLength,
    sha256: `sha256:${createHash('sha256').update(file).digest('hex')}`,
  };
}

function evaluateDirectoryPublicResources(dir: string): PublicResourceReport {
  const publicRoot = join(dir, 'public');
  const entries: ComponentPublicResourceEntry[] = [];
  const diagnostics: ComponentDiagnostic[] = [];
  const seenPublicPaths = new Set<string>();
  let totalBytes = 0;

  if (!existsSync(publicRoot)) {
    return createPublicResourceReport('empty', entries, totalBytes, diagnostics);
  }

  const rootStat = lstatSync(publicRoot);
  if (!rootStat.isDirectory()) {
    diagnostics.push(publicResourceDiagnostic(
      'component_resources.public.path_rejected',
      'error',
      '`public` must be a directory when component resources are used.',
      'Move resource files into a public/ directory or remove the file named public.',
    ));
    return createPublicResourceReport('blocked', entries, totalBytes, diagnostics);
  }

  function walk(currentDir: string): void {
    for (const entry of readdirSync(currentDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(currentDir, entry.name);
      const relativePath = relative(publicRoot, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        const normalized = normalizePublicResourcePath(relativePath);
        if (!normalized.ok) {
          diagnostics.push(publicResourceDiagnostic(
            'component_resources.public.path_rejected',
            'error',
            `public/${relativePath}: ${normalized.reason}`,
            'Use simple relative resource paths without dot segments, backslashes, URLs, or unsupported characters.',
          ));
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile()) {
        diagnostics.push(publicResourceDiagnostic(
          'component_resources.public.path_rejected',
          'error',
          `public/${relativePath}: only ordinary files are allowed in public resources.`,
          'Remove symlinks, sockets, devices, and other non-file entries from public/.',
        ));
        continue;
      }

      const normalized = normalizePublicResourcePath(relativePath);
      if (!normalized.ok) {
        diagnostics.push(publicResourceDiagnostic(
          'component_resources.public.path_rejected',
          'error',
          `public/${relativePath}: ${normalized.reason}`,
          'Use simple relative resource paths without dot segments, backslashes, URLs, or unsupported characters.',
        ));
        continue;
      }
      if (seenPublicPaths.has(normalized.publicPath)) {
        diagnostics.push(publicResourceDiagnostic(
          'component_resources.public.path_rejected',
          'error',
          `${normalized.publicPath}: duplicate normalized public resource path.`,
          'Keep one file for each public resource path.',
        ));
        continue;
      }
      seenPublicPaths.add(normalized.publicPath);

      const resourceType = classifyPublicResource(relativePath);
      if (!resourceType) {
        diagnostics.push(publicResourceDiagnostic(
          'component_resources.public.content_type_rejected',
          'error',
          `${normalized.sourcePath}: unsupported public resource file type.`,
          `Use one of the supported extensions: ${supportedPublicResourceExtensions().join(', ')}.`,
        ));
        continue;
      }

      const data = readFileSync(full);
      const sizeBytes = data.byteLength;
      if (sizeBytes > PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxFileBytes) {
        diagnostics.push(publicResourceDiagnostic(
          'component_resources.public.file_too_large',
          'error',
          `${normalized.sourcePath}: file is ${sizeBytes} bytes, above the ${PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxFileBytes} byte limit.`,
          'Compress the asset, reduce resolution/duration, or pass larger media through platform-managed assets.',
        ));
        continue;
      }
      if (resourceType.contentType === 'image/svg+xml') {
        const svgDiagnostic = unsafeSvgDiagnostic(normalized.sourcePath, data);
        if (svgDiagnostic) {
          diagnostics.push(svgDiagnostic);
          continue;
        }
      }
      totalBytes += sizeBytes;

      entries.push({
        publicPath: normalized.publicPath,
        sourcePath: normalized.sourcePath,
        artifactPath: `resources/public/${normalized.relativePath}`,
        kind: resourceType.kind,
        contentType: resourceType.contentType,
        sizeBytes,
        sha256: sha256Buffer(data),
      });
    }
  }

  walk(publicRoot);

  if (entries.length > PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxFiles) {
    diagnostics.push(publicResourceDiagnostic(
      'component_resources.public.too_many_files',
      'error',
      `public/ contains ${entries.length} accepted resource files, above the ${PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxFiles} file limit.`,
      'Keep component resources small and reusable; move large media sets to platform-managed assets.',
    ));
  }
  if (totalBytes > PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxTotalBytes) {
    diagnostics.push(publicResourceDiagnostic(
      'component_resources.public.total_bytes_exceeded',
      'error',
      `public/ resources total ${totalBytes} bytes, above the ${PROMPTFRAME_PUBLIC_RESOURCE_LIMITS.maxTotalBytes} byte limit.`,
      'Reduce bundled resources or move large media to platform-managed assets.',
    ));
  }
  if (entries.length > 0 && !diagnostics.some((item) => item.severity === 'error')) {
    diagnostics.push(publicResourceDiagnostic(
      'component_resources.public.accepted',
      'info',
      `Accepted ${entries.length} public resource file${entries.length === 1 ? '' : 's'} (${totalBytes} bytes).`,
    ));
  }

  return createPublicResourceReport(
    diagnostics.some((item) => item.severity === 'error') ? 'blocked' : entries.length > 0 ? 'accepted' : 'empty',
    entries.sort((left, right) => left.publicPath.localeCompare(right.publicPath)),
    totalBytes,
    diagnostics,
  );
}

function createPublicResourceReport(
  status: PublicResourceReportStatus,
  entries: ComponentPublicResourceEntry[],
  totalBytes: number,
  diagnostics: ComponentDiagnostic[],
): PublicResourceReport {
  return {
    contractVersion: COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
    policyVersion: PROMPTFRAME_PUBLIC_RESOURCE_POLICY.policyVersion,
    sourceDirectory: 'public',
    status,
    total: entries.length,
    totalBytes,
    entries,
    diagnostics,
  };
}

function assertPublicResourcesAccepted(report: PublicResourceReport): void {
  const firstError = report.diagnostics.find((item) => item.severity === 'error');
  if (!firstError) return;
  fail(firstError.message, firstError.code);
}

function normalizePublicResourcePath(relativePath: string): (
  | { ok: true; relativePath: string; publicPath: `/${string}`; sourcePath: `public/${string}` }
  | { ok: false; reason: string }
) {
  const value = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.endsWith('/')) return { ok: false, reason: 'empty resource path.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { ok: false, reason: 'URL-like paths are not allowed.' };
  if (value.includes('//')) return { ok: false, reason: 'double slashes are not allowed.' };
  const parts = value.split('/');
  if (parts.some((part) => part === '.' || part === '..' || part.trim() !== part || part.length === 0)) {
    return { ok: false, reason: 'dot segments and whitespace-padded path parts are not allowed.' };
  }
  if (!/^[A-Za-z0-9._~!$&'()+,;=@/-]+$/.test(value)) {
    return { ok: false, reason: 'path contains unsupported characters.' };
  }
  return {
    ok: true,
    relativePath: value,
    publicPath: `/${value}`,
    sourcePath: `public/${value}`,
  };
}

function classifyPublicResource(relativePath: string): { kind: ComponentPublicResourceKind; contentType: string } | undefined {
  const ext = extname(relativePath).toLowerCase();
  switch (ext) {
    case '.png':
      return { kind: 'image', contentType: 'image/png' };
    case '.jpg':
    case '.jpeg':
      return { kind: 'image', contentType: 'image/jpeg' };
    case '.webp':
      return { kind: 'image', contentType: 'image/webp' };
    case '.gif':
      return { kind: 'image', contentType: 'image/gif' };
    case '.svg':
      return { kind: 'image', contentType: 'image/svg+xml' };
    case '.mp3':
      return { kind: 'audio', contentType: 'audio/mpeg' };
    case '.wav':
      return { kind: 'audio', contentType: 'audio/wav' };
    case '.m4a':
      return { kind: 'audio', contentType: 'audio/mp4' };
    case '.ogg':
      return { kind: 'audio', contentType: 'audio/ogg' };
    case '.mp4':
      return { kind: 'video', contentType: 'video/mp4' };
    case '.webm':
      return { kind: 'video', contentType: 'video/webm' };
    case '.woff':
      return { kind: 'font', contentType: 'font/woff' };
    case '.woff2':
      return { kind: 'font', contentType: 'font/woff2' };
    case '.json':
      return { kind: 'json', contentType: 'application/json' };
    case '.txt':
      return { kind: 'text', contentType: 'text/plain; charset=utf-8' };
    case '.csv':
      return { kind: 'text', contentType: 'text/csv; charset=utf-8' };
    default:
      return undefined;
  }
}

function supportedPublicResourceExtensions(): string[] {
  return Object.values(PROMPTFRAME_PUBLIC_RESOURCE_POLICY.allowedExtensions).flat().sort();
}

function unsafeSvgDiagnostic(sourcePath: string, data: Buffer): ComponentDiagnostic | undefined {
  const text = data.toString('utf8');
  if (/<\s*script\b/i.test(text)
    || /<\s*foreignObject\b/i.test(text)
    || /\son[a-z]+\s*=/i.test(text)
    || /\b(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|data:|javascript:)/i.test(text)
    || /\burl\s*\(\s*["']?\s*(?:https?:|data:|javascript:)/i.test(text)) {
    return publicResourceDiagnostic(
      'component_resources.public.svg_rejected',
      'error',
      `${sourcePath}: SVG is outside the PromptFrame safe subset.`,
      'Remove scripts, foreignObject, event handlers, external hrefs and javascript/data URLs, or use a raster image.',
    );
  }
  return undefined;
}

function publicResourceDiagnostic(
  code: string,
  severity: ComponentDiagnostic['severity'],
  message: string,
  repairHint?: string,
): ComponentDiagnostic {
  return {
    code,
    severity,
    stage: 'package',
    message,
    ...(repairHint ? { repairHint } : {}),
  };
}

function readPackageManifestFromZip(path: string): ComponentPackageJson {
  const packageEntry = readPackageJsonEntryFromZip(readFileSync(path));
  if (!packageEntry) return {};
  try {
    return JSON.parse(packageEntry.toString('utf8')) as ComponentPackageJson;
  } catch {
    fail('package.json inside source archive must be valid JSON before upload.', 'upload.package_json.invalid');
  }
}

function readPackageJsonEntryFromZip(zip: Buffer): Buffer | undefined {
  let offset = 0;
  let selected: Buffer | undefined;
  let selectedName: string | undefined;
  while (offset + 30 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (nameStart > zip.length || dataStart > zip.length || dataEnd > zip.length) break;

    const entryName = zip.subarray(nameStart, nameStart + nameLength).toString('utf8').replace(/\\/g, '/');
    if ((flags & 0x08) === 0 && isPackageJsonZipEntry(entryName)) {
      const data = decodeZipEntry(zip.subarray(dataStart, dataEnd), method);
      if (!selectedName || entryName.length < selectedName.length) {
        selected = data;
        selectedName = entryName;
      }
    }
    offset = dataEnd;
  }
  return selected;
}

function isPackageJsonZipEntry(entryName: string): boolean {
  const normalized = entryName.replace(/^\/+/, '');
  return normalized === 'package.json'
    || (
      normalized.endsWith('/package.json')
      && !normalized.includes('/node_modules/')
      && !normalized.includes('/dist/')
      && !normalized.includes('/.git/')
    );
}

function decodeZipEntry(data: Buffer, method: number): Buffer {
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  fail(`Unsupported package.json compression method in source archive: ${method}.`, 'upload.package_json.unsupported_zip');
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
        if (entry.name === LOCKFILE_EVIDENCE_FILE_NAME) continue;
        if (isPackageManagerLockfile(entry.name)) continue;
        files.push({
          name: relative(root, full).replace(/\\/g, '/'),
          data: readFileSync(full),
        });
      }
    }
  }
  walk(root);
  const evidence = buildLockfileEvidenceFile(root);
  if (evidence) files.push(evidence);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function buildLockfileEvidenceFile(root: string): { name: string; data: Buffer } | undefined {
  const lockfiles = collectRootPackageManagerLockfiles(root);
  if (lockfiles.length === 0) return undefined;
  const packageJson = readFileSync(join(root, 'package.json'));
  const receipt = {
    schemaVersion: LOCKFILE_EVIDENCE_SCHEMA_VERSION,
    packageJsonSha256: sha256Buffer(packageJson),
    lockfiles: lockfiles.map((lockfile) => ({
      fileName: lockfile.name,
      sizeBytes: lockfile.data.byteLength,
      sha256: sha256Buffer(lockfile.data),
    })),
  };
  return {
    name: LOCKFILE_EVIDENCE_FILE_NAME,
    data: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
  };
}

function collectRootPackageManagerLockfiles(root: string): Array<{ name: string; data: Buffer }> {
  const lockfiles: Array<{ name: string; data: Buffer }> = [];
  for (const name of PACKAGE_MANAGER_LOCKFILE_NAMES) {
    const full = join(root, name);
    if (!existsSync(full)) continue;
    lockfiles.push({ name, data: readFileSync(full) });
  }
  return lockfiles;
}

function sha256Buffer(data: Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function isPackageManagerLockfile(fileName: string): boolean {
  return PACKAGE_MANAGER_LOCKFILE_NAME_SET.has(fileName);
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
  const credential = asRecord(config.credential);
  return compactRecord({
    endpoint: config.endpoint,
    tenantId: config.tenantId,
    userId: config.userId,
    projectId: config.projectId,
    sessionId: config.sessionId,
    credentialTokenId: credential?.tokenId,
    credentialTokenKind: credential?.tokenKind,
    credentialExpiresAt: credential?.expiresAt,
  });
}

function diagnostic(
  code: string,
  severity: 'info' | 'warning' | 'error',
  message: string,
): { code: string; severity: 'info' | 'warning' | 'error'; message: string } {
  return { code, severity, message };
}

function printDiagnostics(diagnostics: Array<LocalReusabilityDiagnostic | ComponentDiagnostic>): void {
  for (const item of diagnostics) {
    console.log(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    if (item.repairHint) console.log(`Hint: ${item.repairHint}`);
  }
}

function formatPackageFreshnessFailure(
  diagnostics: PackageFreshnessDiagnostic[],
  target: AuthoringUploadTarget,
): string {
  return [
    `PromptFrame authoring package freshness check failed for target=${target}.`,
    ...diagnostics.map((item) => {
      const current = item.current ? ` current=${item.current};` : '';
      return `${item.code}: ${item.packageName}; minimum=${item.minimum};${current} ${item.message}`;
    }),
    'Run promptframe upgrade . --apply, then rerun promptframe check/upload.',
  ].join(' ');
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

function requiredPayloadString(payload: Record<string, unknown>, key: string, code: string): string {
  const value = stringValue(payload[key]);
  if (!value) fail(`PromptFrame response did not include ${key}.`, code, 2);
  return value;
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
  check <dir>                      Validate, report rule IDs, and check standard freshness
  upgrade <dir>                    Update PromptFrame package floors (--dry-run by default)
  preview <dir>                    Validate and print local Remotion preview envelope
    --write-local-report           Write .promptframe/local-previews/preview-report.json
  dev <dir>                        Start the local Remotion Player preview server
  package <dir> --out <zip>        Validate and package a component source zip
  upload <dir|zip>                 Upload component source package to PromptFrame
    --target <target>              marketplace_authoring or project_private_generation
    --target marketplace --strict  Alias for strict external marketplace authoring
  status <buildId>                 Fetch component build status
  reindex <buildId>                Rebuild component search/evidence indexes
  probe <buildId> --level <level>  Rerun component layout/security probe
  login --endpoint <url>             Start browser login code flow and store a CLI token
    --token <token>                  Verify and store an already issued CLI/CI token
  whoami                            Show the current PromptFrame CLI identity
  logout                            Revoke the current CLI token and clear local config
  setup-ci [dir] --provider github   Write a GitHub Actions workflow skeleton
  configure --endpoint <url>       Write local CLI endpoint/context config

Endpoint resolution:
  --endpoint, PROMPTFRAME_API_BASE, REMOTION_MEDIA_API_BASE, then local config.
  The public CLI embeds no production/private endpoint defaults.
Auth context:
  promptframe login, PROMPTFRAME_CI_TOKEN, or PROMPTFRAME_CLI_TOKEN for formal endpoints.
  login without --token prints a one-time browser URL/code and never prints the token secret.
  --auth-roles / --auth-permissions are local/dev-only smoke helpers.
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
