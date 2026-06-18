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
const PROMPTFRAME_WORKSPACE_SCHEMA_VERSION = 'promptframe-workspace.v0.1.0';
const PROMPTFRAME_PROJECT_CONTEXT_SCHEMA_VERSION = 'promptframe-project-context.v0.1.0';
const PROMPTFRAME_PROJECT_CONTEXT_FILE_NAME = '.promptframerc';
const PROJECT_CONTEXT_FORBIDDEN_KEY_NAMES = new Set([
  'apikey',
  'auth0subject',
  'authorization',
  'citokensecret',
  'clientsecret',
  'cookie',
  'oauthcode',
  'password',
  'token',
  'tokensecret',
]);
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

interface PreparedComponentUpload {
  artifact: ComponentPackageArtifact;
  localReusability?: ReturnType<typeof evaluateDirectoryReusability>;
  diagnostics?: Array<LocalReusabilityDiagnostic | ComponentDiagnostic>;
}

type ComponentSourceMetadata =
  | {
      mode: 'single_component';
      componentPath: '.';
    }
  | {
      mode: 'workspace';
      workspaceConfig: 'promptframe-workspace.json';
      workspaceComponentId: string;
      componentPath: string;
      manifestId: string;
    }
  | {
      mode: 'zip';
    };

interface ResolvedComponentInput {
  dir: string;
  source: ComponentSourceMetadata;
}

interface WorkspaceComponentDeclaration {
  id: string;
  path: string;
}

interface WorkspaceComponentReport extends WorkspaceComponentDeclaration {
  absolutePath: string;
  manifest: Record<string, string | undefined>;
}

interface PackageManagerLockfileEvidence {
  name: string;
  data: Buffer;
  source: 'component' | 'workspace_root';
  relativePath: string;
}

interface PromptFrameProjectContext {
  schemaVersion: typeof PROMPTFRAME_PROJECT_CONTEXT_SCHEMA_VERSION;
  endpoint?: string;
  tenantId?: string;
  projectId?: string;
  projectNamespace?: string;
  defaultUploadTarget?: string;
  workspaceConfig?: string;
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
    case 'discovery':
      await discovery(argv);
      break;
    case 'init':
      await initProjectContext(argv);
      break;
    case 'project':
      await project(argv);
      break;
    case 'projects':
      await project(['list', ...argv]);
      break;
    case 'component':
    case 'components':
      await component(argv);
      break;
    case 'ci-token':
    case 'token':
      await ciToken(argv);
      break;
    case 'workspace':
      workspace(argv);
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
  const input = resolveComponentInput(argv);
  const dir = input.dir;
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
    source: input.source,
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
  const workspaceRoot = autoWorkspaceRoot(argv);
  if (workspaceRoot) {
    await checkWorkspace(argv, workspaceRoot);
    return;
  }
  const input = resolveComponentInput(argv);
  const target = resolveUploadTarget(argv);
  const freshness = await resolveSoftRemoteStandardFreshness(argv, target, 'check');
  const output = buildCheckOutput(input, target, freshness);
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`check passed: ${input.dir}`);
  console.log(`Target: ${target}`);
  console.log(`Freshness: ${output.freshness.status}`);
  printDiagnostics(output.diagnostics);
}

async function checkWorkspace(argv: string[], root: string): Promise<void> {
  const target = resolveUploadTarget(argv);
  const freshness = await resolveSoftRemoteStandardFreshness(argv, target, 'check');
  const reports = collectWorkspaceComponentReports(root);
  const components = reports.map((report) => ({
    id: report.id,
    path: report.path,
    ...buildCheckOutput(workspaceComponentInput(report), target, freshness),
  }));
  const diagnostics = components.flatMap((component) => component.diagnostics);
  const output = {
    command: 'check' as const,
    workspace: true,
    workspaceRoot: root,
    source: {
      mode: 'workspace',
      workspaceConfig: 'promptframe-workspace.json',
    },
    target,
    freshness,
    components,
    diagnostics,
    diagnostic: diagnostic('check.workspace.completed', 'info', 'Workspace component authoring checks completed.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`workspace check passed: ${root}`);
  console.log(`Components: ${components.length}`);
  console.log(`Freshness: ${freshness.status}`);
  printDiagnostics(diagnostics);
}

function buildCheckOutput(
  input: ResolvedComponentInput,
  target: AuthoringUploadTarget,
  freshness: AuthoringStandardFreshnessDecision,
): {
  command: 'check';
  dir: string;
  source: ComponentSourceMetadata;
  manifest: Record<string, string | undefined>;
  checkedRuleIds: PublicPolicyRuleId[];
  securityPolicyVersion: string;
  securityPolicyDigest: string;
  securityEvaluatorMode: string;
  freshness: AuthoringStandardFreshnessDecision;
  localReusability: ReturnType<typeof evaluateDirectoryReusability>;
  dependencyPolicy: PromptFrameDependencyPolicyReceipt;
  publicResources: PublicResourceReport;
  diagnostics: Array<LocalReusabilityDiagnostic | ComponentDiagnostic>;
  diagnostic: { code: string; severity: 'info' | 'warning' | 'error'; message: string };
} {
  const dir = input.dir;
  const manifest = validateComponentDirectory(dir);
  assertAuthoringPackageFreshness(dir, target);
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
    command: 'check' as const,
    dir,
    source: input.source,
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
  return output;
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
  const input = resolveComponentInput(argv);
  const dir = input.dir;
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
    source: input.source,
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
  const input = resolveComponentInput(argv);
  const dir = input.dir;
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
    source: input.source,
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
  const input = resolveComponentInput(argv);
  const artifact = packageDirectory(input.dir, valueAfter(argv, '--out'));
  printJson({
    command: 'package',
    diagnostic: diagnostic('package.completed', 'info', 'Component source archive created.'),
    out: artifact.out,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    source: input.source,
    publicResources: artifact.publicResources,
  });
}

function validateComponentDirectory(dir: string): ComponentManifest {
  assertRequiredFiles(dir);
  assertDependencyPolicyAccepted(evaluateDirectoryDependencyPolicy(dir));
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const parsed = parseComponentManifest(normalizeLegacyManifest(manifest));
  validatePreviewProps(dir, parsed);
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
  return collectPackageManagerLockfileEvidence(dir).length > 0;
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
  const workspaceComponent = valueAfter(argv, '--workspace-component');
  const target = resolve(componentPathArg(argv) ?? '.');
  const uploadTarget = resolveUploadTarget(argv);
  if (workspaceComponent && target.endsWith('.zip')) {
    fail('upload --workspace-component requires a workspace root, not a zip file.', 'workspace.component.zip_unsupported', 2);
  }
  const workspaceRoot = autoWorkspaceRoot(argv);
  if (workspaceRoot) {
    await uploadWorkspace(argv, workspaceRoot, uploadTarget);
    return;
  }
  const input: ResolvedComponentInput = target.endsWith('.zip')
    ? { dir: target, source: { mode: 'zip' } }
    : resolveComponentInput(argv);
  const prepared = prepareComponentUpload(input, uploadTarget, valueAfter(argv, '--out'));
  const endpoint = resolveEndpoint('upload', argv);
  await assertRemoteStandardFreshness(endpoint, argv);
  const output = await uploadPreparedComponent(input, argv, endpoint, uploadTarget, prepared);
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log('Upload accepted by PromptFrame platform.');
  console.log(`Build: ${output.jobId ?? 'unknown'}`);
  console.log(`Status: ${stringValue(output.status) ?? stringValue(asRecord(output.build)?.status) ?? 'queued'}`);
  if (output.jobId) {
    console.log(`Next: promptframe status ${output.jobId} --endpoint ${endpoint}`);
  }
  printDiagnostics(arrayValue(output.diagnostics) as Array<LocalReusabilityDiagnostic | ComponentDiagnostic>);
  printStatusUrl(endpoint, output);
}

async function uploadWorkspace(
  argv: string[],
  root: string,
  uploadTarget: AuthoringUploadTarget,
): Promise<void> {
  if (valueAfter(argv, '--out')) {
    fail(
      'upload --out is only supported for a single component. Use --workspace-component <id> or omit --out when uploading a workspace root.',
      'workspace.upload.out_unsupported',
      2,
    );
  }
  const reports = collectWorkspaceComponentReports(root);
  const preparedUploads = reports.map((report) => {
    const input = workspaceComponentInput(report);
    return {
      input,
      prepared: prepareComponentUpload(input, uploadTarget, undefined),
    };
  });
  const endpoint = resolveEndpoint('upload', argv);
  await assertRemoteStandardFreshness(endpoint, argv);
  const uploads = [];
  for (const item of preparedUploads) {
    uploads.push(await uploadPreparedComponent(item.input, argv, endpoint, uploadTarget, item.prepared));
  }
  const output = {
    command: 'upload',
    workspace: true,
    workspaceRoot: root,
    source: {
      mode: 'workspace',
      workspaceConfig: 'promptframe-workspace.json',
    },
    uploadTarget,
    uploads,
    diagnostic: diagnostic('upload.workspace.completed', 'info', 'Workspace component uploads accepted by platform.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Workspace upload accepted: ${root}`);
  for (const upload of uploads) {
    const source = asRecord(upload.source);
    console.log(`${stringValue(source?.workspaceComponentId) ?? 'component'} -> ${upload.jobId ?? 'unknown'}`);
  }
}

function prepareComponentUpload(
  input: ResolvedComponentInput,
  uploadTarget: AuthoringUploadTarget,
  outArg: string | undefined,
): PreparedComponentUpload {
  let localReusability: ReturnType<typeof evaluateDirectoryReusability> | undefined;
  const artifact = input.source.mode === 'zip'
    ? packageZipForUpload(input.dir, uploadTarget)
    : packageDirectoryForUploadWithLocalReusability(
        input.dir,
        uploadTarget,
        outArg,
        (reusability) => {
          localReusability = reusability;
        },
      );
  const diagnostics = localReusability
    ? [
        ...reusabilityDiagnostics(localReusability),
        ...stylePropDiagnostics(input.dir),
        ...(artifact.publicResources?.diagnostics ?? []),
      ]
    : undefined;
  return { artifact, localReusability, diagnostics };
}

async function uploadPreparedComponent(
  input: ResolvedComponentInput,
  argv: string[],
  endpoint: string,
  uploadTarget: AuthoringUploadTarget,
  prepared: PreparedComponentUpload,
): Promise<Record<string, unknown>> {
  const { artifact, localReusability, diagnostics } = prepared;
  const file = readFileSync(artifact.out);
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(file)], { type: 'application/zip' }), basename(artifact.out));
  const payload = await fetchJson(`${endpoint}/components/marketplace/upload`, {
    method: 'POST',
    body: form,
    headers: {
      ...buildRemoteHeaders(endpoint, argv),
      ...buildSecurityPolicyHeaders(),
      ...buildSourceMetadataHeaders(input.source),
      'x-promptframe-upload-target': uploadTarget,
    },
  }, 'upload.http.failed');
  const safePayload = sanitizePublicUploadPayload(payload);
  const output = sanitizePublicUploadPayload({
    ...safePayload,
    command: 'upload',
    endpoint,
    uploadTarget,
    jobId: getBuildId(payload),
    package: artifact,
    source: input.source,
    ...(localReusability ? { localReusability, diagnostics } : {}),
    diagnostic: diagnostic('upload.completed', 'info', 'Component upload accepted by platform.'),
  });
  return output;
}

const PUBLIC_UPLOAD_JSON_OMIT_KEYS = new Set([
  'providerUsageReceipt',
  'providerUsageReceipts',
  'vectorRef',
  'retryKey',
  'sourceHash',
  'sourceHashDetails',
  'internalSourceHash',
  'schemaHash',
  'manifestHash',
  'bundleHash',
  'evidence',
  'evidenceRecords',
  'evidenceItems',
  'rawEvidence',
]);

function sanitizePublicUploadPayload(value: unknown): Record<string, unknown> {
  return asRecord(sanitizePublicUploadValue(value)) ?? {};
}

function sanitizePublicUploadValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubInternalReferences(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicUploadValue(item));
  }
  const record = asRecord(value);
  if (!record) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (PUBLIC_UPLOAD_JSON_OMIT_KEYS.has(key)) continue;
    output[key] = sanitizePublicUploadValue(entry);
  }
  return output;
}

function scrubInternalReferences(value: string): string {
  return value
    .replace(/\bREQ-\d+\b/g, 'internal reference')
    .replace(/\bTASK-\d+(?:-[A-Za-z0-9-]+)?\b/g, 'internal task')
    .replace(/\bBUG-\d+\b/g, 'internal bug');
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

function workspace(argv: string[]): void {
  const subcommand = argv[0] ?? 'validate';
  const rest = argv.slice(argv[0] ? 1 : 0);
  switch (subcommand) {
    case 'validate':
      workspaceValidate(rest);
      break;
    case 'list':
      workspaceList(rest);
      break;
    case 'init':
      workspaceInit(rest);
      break;
    case 'add':
      workspaceAdd(rest);
      break;
    default:
      fail(`Unknown workspace command: ${subcommand}`, 'workspace.command.unknown', 2);
  }
}

function workspaceValidate(argv: string[]): void {
  const root = resolve(componentPathArg(argv) ?? '.');
  const reports = collectWorkspaceComponentReports(root);
  const output = {
    command: 'workspace.validate',
    workspace: workspaceSummary(root),
    components: reports.map(workspaceReportForOutput),
    diagnostic: diagnostic('workspace.validate.completed', 'info', 'PromptFrame workspace configuration is valid.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`workspace valid: ${root}`);
  for (const component of reports) {
    console.log(`${component.id} -> ${component.path}`);
  }
}

function workspaceList(argv: string[]): void {
  const root = resolve(componentPathArg(argv) ?? '.');
  const reports = collectWorkspaceComponentReports(root);
  const output = {
    command: 'workspace.list',
    workspace: workspaceSummary(root),
    components: reports.map(workspaceReportForOutput),
    diagnostic: diagnostic('workspace.list.completed', 'info', 'PromptFrame workspace components listed.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  for (const component of reports) {
    console.log(`${component.id}\t${component.path}`);
  }
}

function workspaceInit(argv: string[]): void {
  const root = resolve(componentPathArg(argv) ?? '.');
  const configPath = workspaceConfigPath(root);
  if (existsSync(configPath) && !hasFlag(argv, '--force')) {
    fail(`PromptFrame workspace config already exists at ${configPath}. Use --force to overwrite.`, 'workspace.config.exists');
  }
  const componentPath = valueAfter(argv, '--component-path');
  const componentId = valueAfter(argv, '--id');
  const components = componentPath || componentId
    ? [{
        id: componentId ?? fail('--id is required when --component-path is provided.', 'workspace.component.id_missing', 2),
        path: normalizeWorkspacePath(componentPath ?? fail('--component-path is required when --id is provided.', 'workspace.component.path_missing', 2)),
      }]
    : [];
  writeWorkspaceConfig(root, components);
  const output = {
    command: 'workspace.init',
    workspace: workspaceSummary(root),
    components,
    diagnostic: diagnostic('workspace.init.completed', 'info', 'PromptFrame workspace configuration written.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Wrote PromptFrame workspace config: ${configPath}`);
}

function workspaceAdd(argv: string[]): void {
  const positionals = positionalArgs(argv);
  const root = resolve(positionals.length >= 2 ? positionals[0]! : '.');
  const rawPath = positionals.length >= 2 ? positionals[1] : positionals[0];
  const componentPath = normalizeWorkspacePath(rawPath ?? fail('workspace add requires a component path.', 'workspace.component.path_missing', 2));
  const id = valueAfter(argv, '--id') ?? fail('workspace add requires --id <component-id>.', 'workspace.component.id_missing', 2);
  const current = readWorkspaceConfig(root);
  const components = [...current.components, { id, path: componentPath }];
  assertNoDuplicateWorkspaceComponents(components);
  writeWorkspaceConfig(root, components);
  const output = {
    command: 'workspace.add',
    workspace: workspaceSummary(root),
    component: { id, path: componentPath },
    diagnostic: diagnostic('workspace.add.completed', 'info', 'PromptFrame workspace component added.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Added workspace component: ${id} -> ${componentPath}`);
}

function resolveComponentInput(argv: string[]): ResolvedComponentInput {
  const workspaceComponentId = valueAfter(argv, '--workspace-component');
  if (!workspaceComponentId) {
    return {
      dir: resolve(componentPathArg(argv) ?? '.'),
      source: {
        mode: 'single_component',
        componentPath: '.',
      },
    };
  }
  const root = resolve(componentPathArg(argv) ?? '.');
  const report = resolveWorkspaceComponent(root, workspaceComponentId);
  return {
    dir: report.absolutePath,
    source: {
      mode: 'workspace',
      workspaceConfig: 'promptframe-workspace.json',
      workspaceComponentId: report.id,
      componentPath: report.path,
      manifestId: stringValue(report.manifest.id) ?? report.id,
    },
  };
}

function autoWorkspaceRoot(argv: string[]): string | undefined {
  if (valueAfter(argv, '--workspace-component')) return undefined;
  const target = resolve(componentPathArg(argv) ?? '.');
  if (target.endsWith('.zip')) return undefined;
  return existsSync(workspaceConfigPath(target)) ? target : undefined;
}

function workspaceComponentInput(report: WorkspaceComponentReport): ResolvedComponentInput {
  return {
    dir: report.absolutePath,
    source: {
      mode: 'workspace',
      workspaceConfig: 'promptframe-workspace.json',
      workspaceComponentId: report.id,
      componentPath: report.path,
      manifestId: stringValue(report.manifest.id) ?? report.id,
    },
  };
}

function resolveWorkspaceComponent(root: string, componentId: string): WorkspaceComponentReport {
  const reports = collectWorkspaceComponentReports(root);
  const report = reports.find((component) => component.id === componentId);
  if (!report) {
    fail(
      `PromptFrame workspace component not found: ${componentId}. Run promptframe workspace list ${root} to inspect configured ids.`,
      'workspace.component.not_found',
      2,
    );
  }
  return report;
}

function collectWorkspaceComponentReports(root: string): WorkspaceComponentReport[] {
  const workspace = readWorkspaceConfig(root);
  if (workspace.components.length === 0) {
    fail(
      'PromptFrame workspace config does not list any components.',
      'workspace.components.empty',
      2,
    );
  }
  return workspace.components.map((component) => {
    const absolutePath = resolve(root, component.path);
    assertWorkspacePathInsideRoot(root, absolutePath, component.path);
    if (!existsSync(absolutePath)) {
      fail(
        `PromptFrame workspace component path does not exist: ${component.path}`,
        'workspace.component.path_missing',
        2,
      );
    }
    const manifest = validateComponentDirectory(absolutePath);
    if (manifest.id !== component.id) {
      fail(
        `PromptFrame workspace component ${component.id} points to ${component.path}, but manifest.json declares ${manifest.id}. Keep promptframe-workspace.json and manifest.json ids identical.`,
        'workspace.component.manifest_id_mismatch',
      );
    }
    return {
      ...component,
      absolutePath,
      manifest: manifestSummary(manifest),
    };
  });
}

function workspaceReportForOutput(report: WorkspaceComponentReport): Record<string, unknown> {
  return {
    id: report.id,
    path: report.path,
    manifest: report.manifest,
  };
}

function workspaceSummary(root: string): Record<string, unknown> {
  return {
    schemaVersion: PROMPTFRAME_WORKSPACE_SCHEMA_VERSION,
    root,
    configPath: workspaceConfigPath(root),
  };
}

function workspaceConfigPath(root: string): string {
  return join(root, 'promptframe-workspace.json');
}

function readWorkspaceConfig(root: string): { schemaVersion: string; components: WorkspaceComponentDeclaration[] } {
  const configPath = workspaceConfigPath(root);
  if (!existsSync(configPath)) {
    fail(
      `PromptFrame workspace config not found at ${configPath}.`,
      'workspace.config.missing',
      2,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    fail(
      `PromptFrame workspace config must be valid JSON: ${configPath}`,
      'workspace.config.invalid_json',
      2,
    );
  }
  const config = asRecord(raw);
  if (!config) {
    fail('PromptFrame workspace config must be a JSON object.', 'workspace.config.invalid', 2);
  }
  const schemaVersion = stringValue(config.schemaVersion);
  if (schemaVersion !== PROMPTFRAME_WORKSPACE_SCHEMA_VERSION) {
    fail(
      `Unsupported PromptFrame workspace schemaVersion: ${schemaVersion ?? '<missing>'}. Expected ${PROMPTFRAME_WORKSPACE_SCHEMA_VERSION}.`,
      'workspace.config.schema_version_unsupported',
      2,
    );
  }
  const rawComponents = arrayValue(config.components);
  const components = rawComponents.map((item, index): WorkspaceComponentDeclaration => {
    const component = asRecord(item);
    if (!component) {
      fail(`PromptFrame workspace components[${index}] must be a JSON object.`, 'workspace.component.invalid', 2);
    }
    const id = stringValue(component.id);
    const path = stringValue(component.path);
    if (!id) {
      fail(`PromptFrame workspace components[${index}].id is required.`, 'workspace.component.id_missing', 2);
    }
    if (!path) {
      fail(`PromptFrame workspace components[${index}].path is required.`, 'workspace.component.path_missing', 2);
    }
    return {
      id,
      path: normalizeWorkspacePath(path),
    };
  });
  assertNoDuplicateWorkspaceComponents(components);
  return { schemaVersion, components };
}

function writeWorkspaceConfig(root: string, components: WorkspaceComponentDeclaration[]): void {
  assertNoDuplicateWorkspaceComponents(components);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    workspaceConfigPath(root),
    `${JSON.stringify({
      schemaVersion: PROMPTFRAME_WORKSPACE_SCHEMA_VERSION,
      components,
    }, null, 2)}\n`,
    'utf8',
  );
}

function assertNoDuplicateWorkspaceComponents(components: WorkspaceComponentDeclaration[]): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) {
      fail(`Duplicate PromptFrame workspace component id: ${component.id}`, 'workspace.component.id_duplicate', 2);
    }
    if (paths.has(component.path)) {
      fail(`Duplicate PromptFrame workspace component path: ${component.path}`, 'workspace.component.path_duplicate', 2);
    }
    ids.add(component.id);
    paths.add(component.path);
  }
}

function normalizeWorkspacePath(rawPath: string): string {
  const normalized = rawPath
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  if (!normalized) {
    fail('PromptFrame workspace component path is required.', 'workspace.component.path_missing', 2);
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    fail(
      `PromptFrame workspace component path must be relative: ${rawPath}`,
      'workspace.component.path_absolute',
      2,
    );
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail(
      `PromptFrame workspace component path must not contain empty, "." or ".." segments: ${rawPath}`,
      'workspace.component.path_unsafe',
      2,
    );
  }
  return normalized;
}

function assertWorkspacePathInsideRoot(root: string, absolutePath: string, displayPath: string): void {
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith('..') || relativePath === '' || /^[A-Za-z]:/.test(relativePath)) {
    fail(
      `PromptFrame workspace component path must stay inside the workspace root: ${displayPath}`,
      'workspace.component.path_unsafe',
      2,
    );
  }
}

function buildSourceMetadataHeaders(source: ComponentSourceMetadata): Record<string, string> {
  if (source.mode !== 'workspace') return {};
  return {
    'x-promptframe-source-mode': 'workspace',
    'x-promptframe-source-workspace-config': source.workspaceConfig,
    'x-promptframe-source-workspace-component-id': source.workspaceComponentId,
    'x-promptframe-source-component-path': source.componentPath,
    'x-promptframe-source-manifest-id': source.manifestId,
  };
}

const POSITIONAL_VALUE_FLAGS = new Set([
  '--allowed-upload-target',
  '--auth-permissions',
  '--auth-roles',
  '--component-path',
  '--component-id',
  '--config',
  '--description',
  '--display-name',
  '--endpoint',
  '--expires-at',
  '--host',
  '--id',
  '--level',
  '--name',
  '--out',
  '--poll-interval-seconds',
  '--port',
  '--provider',
  '--provider-kind',
  '--provider-name',
  '--project-id',
  '--project-context',
  '--project-namespace',
  '--reason',
  '--scope',
  '--session-id',
  '--target',
  '--tenant-id',
  '--timeout-seconds',
  '--token',
  '--upload-target',
  '--user-id',
  '--workspace-config',
  '--workspace-component',
]);

function componentPathArg(argv: string[]): string | undefined {
  return positionalArgs(argv)[0];
}

function positionalArgs(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && POSITIONAL_VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
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
  } else {
    printBuildSummary(output);
  }
  if (hasFlag(argv, '--fail-on-build-failed')) {
    failIfBuildFailed(output);
  }
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

async function discovery(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('discovery', argv);
  const payload = await fetchJson(`${endpoint}/cli/discovery`, {
    headers: buildRemoteHeaders(endpoint, argv, { requireAuth: false }),
  }, 'discovery.http.failed');
  const output = {
    ...payload,
    command: 'discovery',
    endpoint,
    diagnostic: diagnostic('discovery.completed', 'info', 'PromptFrame platform discovery fetched.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Endpoint profile: ${stringValue(payload.endpointProfile) ?? 'unknown'}`);
  console.log(`Auth required: ${payload.authRequired === false ? 'no' : 'yes'}`);
  console.log(`Project discovery requires auth: ${payload.projectDiscoveryRequiresAuth === false ? 'no' : 'yes'}`);
  console.log(`Self CI tokens supported: ${payload.selfCiTokensSupported === false ? 'no' : 'yes'}`);
  const uploadTargets = arrayValue(payload.uploadTargets).map((item) => String(item));
  if (uploadTargets.length > 0) console.log(`Upload targets: ${uploadTargets.join(', ')}`);
}

async function initProjectContext(argv: string[]): Promise<void> {
  const root = resolve(componentPathArg(argv) ?? '.');
  const contextPath = join(root, PROMPTFRAME_PROJECT_CONTEXT_FILE_NAME);
  if (existsSync(contextPath) && !hasFlag(argv, '--force')) {
    fail(`PromptFrame project context already exists at ${contextPath}. Use --force to overwrite.`, 'project_context.exists', 2);
  }
  const endpoint = resolveEndpoint('init', argv);
  const payload = await fetchProjects(endpoint, argv);
  const projects = arrayValue(payload.projects).map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  const requestedProjectId = valueAfter(argv, '--project-id');
  const currentProjectId = requestedProjectId ?? stringValue(payload.currentProjectId);
  const project = projects.find((item) =>
    stringValue(item.projectId) === currentProjectId || (!requestedProjectId && item.isCurrent === true),
  );
  if (!project) {
    fail(
      requestedProjectId
        ? `PromptFrame project ${requestedProjectId} is not available for this credential.`
        : 'PromptFrame did not report an active project for this credential.',
      'project_context.project_missing',
      2,
    );
  }
  const projectId = requiredArg(stringValue(project.projectId), 'PromptFrame project response did not include projectId.', 'project_context.project_id_missing');
  const tenantId = stringValue(project.tenantId);
  const context = buildProjectContext({
    endpoint,
    tenantId,
    projectId,
    projectNamespace: valueAfter(argv, '--project-namespace')
      ?? stringValue(project.projectNamespace)
      ?? normalizeProjectNamespace(projectId),
    defaultUploadTarget: valueAfter(argv, '--target')
      ?? valueAfter(argv, '--upload-target')
      ?? 'marketplace_authoring',
    workspaceConfig: valueAfter(argv, '--workspace-config') ?? 'promptframe-workspace.json',
  });
  mkdirSync(root, { recursive: true });
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  const output = {
    command: 'init',
    endpoint,
    contextPath,
    context,
    project,
    diagnostic: diagnostic('project_context.init.completed', 'info', 'PromptFrame project context written.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Wrote PromptFrame project context: ${contextPath}`);
  console.log(`Project: ${projectId}`);
}

async function project(argv: string[]): Promise<void> {
  const subcommand = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  if (subcommand !== 'list' && subcommand !== 'current') {
    fail(
      'project supports read-only subcommands today: project list or project current. Server-side project use is not available yet.',
      'project.subcommand.unsupported',
      2,
    );
  }
  const endpoint = resolveEndpoint('project', argv);
  const payload = await fetchProjects(endpoint, argv);
  const projects = arrayValue(payload.projects);
  const currentProjectId = stringValue(payload.currentProjectId);
  const currentProject = projects
    .map((item) => asRecord(item))
    .find((item) => stringValue(item?.projectId) === currentProjectId || item?.isCurrent === true);
  if (subcommand === 'current') {
    if (!currentProject) {
      fail(
        'PromptFrame did not report an active project for this credential.',
        'project.current.missing',
        2,
      );
    }
    const output = {
      command: 'project.current',
      endpoint,
      currentProjectId: stringValue(currentProject.projectId),
      currentProject,
      diagnostic: diagnostic('project.current.completed', 'info', 'PromptFrame current project fetched.'),
    };
    if (hasFlag(argv, '--json')) {
      printJson(output);
      return;
    }
    printProjectLine(currentProject, true);
    return;
  }

  const output = {
    ...payload,
    command: 'project.list',
    endpoint,
    diagnostic: diagnostic('project.list.completed', 'info', 'PromptFrame project list fetched.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  console.log(`Endpoint: ${endpoint}`);
  if (projects.length === 0) {
    console.log('No active projects are available for this credential.');
    return;
  }
  for (const item of projects) {
    const record = asRecord(item);
    if (record) printProjectLine(record, stringValue(record.projectId) === currentProjectId || record.isCurrent === true);
  }
}

async function fetchProjects(endpoint: string, argv: string[]): Promise<Record<string, unknown>> {
  return fetchJson(`${endpoint}/cli/projects`, {
    headers: buildRemoteHeaders(endpoint, argv),
  }, 'project.http.failed');
}

async function component(argv: string[]): Promise<void> {
  const subcommand = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  const rest = argv.slice(argv[0] && !argv[0].startsWith('--') ? 1 : 0);
  switch (subcommand) {
    case 'list':
      await componentList(rest);
      break;
    case 'create':
      await componentCreate(rest);
      break;
    default:
      fail(`Unknown component command: ${subcommand}`, 'component.command.unknown', 2);
  }
}

async function componentList(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('component', argv);
  const params = new URLSearchParams();
  const componentId = valueAfter(argv, '--component-id') ?? positionalArgs(argv)[0];
  if (componentId) params.set('componentId', assertComponentId(componentId));
  const query = params.toString();
  const payload = await fetchJson(`${endpoint}/components/marketplace/self/components${query ? `?${query}` : ''}`, {
    headers: buildRemoteHeaders(endpoint, argv),
  }, 'component.list.http.failed');
  const output = {
    ...payload,
    command: 'component.list',
    endpoint,
    diagnostic: diagnostic('component.list.completed', 'info', 'PromptFrame project components listed.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  for (const item of arrayValue(payload.declarations)) {
    const declaration = asRecord(item);
    if (declaration) printComponentDeclarationLine(declaration);
  }
}

async function componentCreate(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('component', argv);
  const componentId = assertComponentId(requiredArg(positionalArgs(argv)[0], 'component create requires <component-id>.', 'component.id_missing'));
  const displayName = requiredArg(
    valueAfter(argv, '--display-name') ?? valueAfter(argv, '--name') ?? displayNameFromComponentId(componentId),
    'component create requires --display-name <name>.',
    'component.display_name_missing',
  );
  const description = valueAfter(argv, '--description');
  const payload = compactRecord({
    componentId,
    displayName,
    description,
  });
  const response = await fetchJson(`${endpoint}/components/marketplace/self/components`, {
    method: 'POST',
    headers: {
      ...buildRemoteHeaders(endpoint, argv),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, 'component.create.http.failed');
  const output = {
    ...response,
    command: 'component.create',
    endpoint,
    diagnostic: diagnostic('component.create.completed', 'info', 'PromptFrame project component declared.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  const declaration = asRecord(response.declaration);
  if (declaration) printComponentDeclarationLine(declaration);
}

function printComponentDeclarationLine(declaration: Record<string, unknown>): void {
  const componentId = stringValue(declaration.componentId) ?? 'unknown';
  const status = stringValue(declaration.status) ?? 'unknown';
  const displayName = stringValue(declaration.displayName) ?? componentId;
  console.log(`${componentId}\t${status}\t${displayName}`);
}

function printProjectLine(project: Record<string, unknown>, current: boolean): void {
  const prefix = current ? '*' : '-';
  const projectId = stringValue(project.projectId) ?? 'unknown';
  const name = stringValue(project.name) ?? projectId;
  const role = stringValue(project.role) ?? 'unknown';
  const visibility = stringValue(project.visibility) ?? 'unknown';
  console.log(`${prefix} ${name} (${projectId}) role=${role} visibility=${visibility}`);
}

async function ciToken(argv: string[]): Promise<void> {
  const subcommand = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  switch (subcommand) {
    case 'create':
      await createSelfCiToken(argv.slice(1));
      break;
    case 'list':
      await listSelfCiTokens(argv.slice(1));
      break;
    case 'revoke':
      await revokeSelfCiToken(argv.slice(1));
      break;
    default:
      fail('ci-token supports: create, list, revoke.', 'ci_token.subcommand.unsupported', 2);
  }
}

async function createSelfCiToken(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('ci-token.create', argv);
  const name = requiredValue(argv, '--name');
  const scopes = valuesAfter(argv, '--scope');
  const uploadTargets = [
    ...valuesAfter(argv, '--upload-target'),
    ...valuesAfter(argv, '--allowed-upload-target'),
  ];
  const payload = {
    contractVersion: CLI_AUTH_CONTRACT_VERSION,
    name,
    scopes: scopes.length > 0 ? scopes : ['component.upload'],
    allowedUploadTargets: uploadTargets.length > 0 ? uploadTargets : ['marketplace_authoring'],
    expiresAt: valueAfter(argv, '--expires-at') ?? defaultCiTokenExpiresAt(),
    reason: valueAfter(argv, '--reason') ?? 'Self-service CI token created by PromptFrame CLI.',
  };
  const response = await fetchJson(`${endpoint}/cli/tokens/self`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildRemoteHeaders(endpoint, argv),
    },
    body: JSON.stringify(payload),
  }, 'ci_token.create.http.failed');
  const output = {
    ...response,
    command: 'ci-token.create',
    endpoint,
    diagnostic: diagnostic('ci_token.create.completed', 'info', 'Self-service CI token created. Store the token secret securely; it is shown only once.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  const token = asRecord(response.token);
  console.log(`Created CI token: ${stringValue(token?.tokenId) ?? 'unknown'}`);
  console.log('Token secret is shown once. Store it in your CI secret manager now.');
  console.log(`Secret: ${stringValue(response.tokenSecret) ?? '<missing>'}`);
}

async function listSelfCiTokens(argv: string[]): Promise<void> {
  const endpoint = resolveEndpoint('ci-token.list', argv);
  const params = new URLSearchParams();
  appendOptionalParam(params, 'pageSize', valueAfter(argv, '--page-size') ?? valueAfter(argv, '--limit'));
  appendOptionalParam(params, 'cursor', valueAfter(argv, '--cursor'));
  appendOptionalParam(params, 'tokenId', valueAfter(argv, '--token-id'));
  appendOptionalParam(params, 'name', valueAfter(argv, '--name'));
  appendOptionalParam(params, 'status', valueAfter(argv, '--status'));
  appendOptionalParam(params, 'scope', valueAfter(argv, '--scope'));
  appendOptionalParam(params, 'uploadTarget', valueAfter(argv, '--upload-target'));
  const query = params.toString();
  const response = await fetchJson(`${endpoint}/cli/tokens/self${query ? `?${query}` : ''}`, {
    headers: buildRemoteHeaders(endpoint, argv),
  }, 'ci_token.list.http.failed');
  const output = {
    ...response,
    command: 'ci-token.list',
    endpoint,
    diagnostic: diagnostic('ci_token.list.completed', 'info', 'Self-service CI token list fetched.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  const tokens = arrayValue(response.items).length > 0 ? arrayValue(response.items) : arrayValue(response.tokens);
  if (tokens.length === 0) {
    console.log('No self-service CI tokens found for this credential.');
    return;
  }
  for (const item of tokens) {
    const token = asRecord(item);
    if (!token) continue;
    const status = token.revokedAt ? 'revoked' : 'active';
    console.log(`${stringValue(token.tokenId) ?? 'unknown'} ${stringValue(token.name) ?? ''} ${status}`.trim());
  }
}

async function revokeSelfCiToken(argv: string[]): Promise<void> {
  const tokenId = requiredArg(argv[0], 'ci-token revoke requires a token id', 'ci_token.revoke.token_id.missing');
  const endpoint = resolveEndpoint('ci-token.revoke', argv);
  const response = await fetchJson(`${endpoint}/cli/tokens/self/${encodeURIComponent(tokenId)}/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildRemoteHeaders(endpoint, argv),
    },
    body: JSON.stringify({
      contractVersion: CLI_AUTH_CONTRACT_VERSION,
      reason: valueAfter(argv, '--reason') ?? 'Self-service CI token revoked by PromptFrame CLI.',
    }),
  }, 'ci_token.revoke.http.failed');
  const output = {
    ...response,
    command: 'ci-token.revoke',
    endpoint,
    diagnostic: diagnostic('ci_token.revoke.completed', 'info', 'Self-service CI token revoked.'),
  };
  if (hasFlag(argv, '--json')) {
    printJson(output);
    return;
  }
  const token = asRecord(response.token);
  console.log(`Revoked CI token: ${stringValue(token?.tokenId) ?? tokenId}`);
}

function defaultCiTokenExpiresAt(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function appendOptionalParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value) params.set(key, value);
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
  const workspaceMode = hasFlag(argv, '--workspace');
  const workspaceReports = workspaceMode ? collectWorkspaceComponentReports(targetDir) : [];
  const workflowPath = join(
    targetDir,
    '.github',
    'workflows',
    workspaceMode ? 'promptframe-workspace.yml' : 'promptframe-component.yml',
  );
  if (existsSync(workflowPath) && !hasFlag(argv, '--force')) {
    fail(
      `PromptFrame GitHub workflow already exists at ${workflowPath}. Use --force to overwrite.`,
      'setup_ci.workflow.exists',
    );
  }
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(
    workflowPath,
    workspaceMode ? promptFrameGithubWorkspaceWorkflow(workspaceReports) : promptFrameGithubWorkflow(),
    'utf8',
  );
  const output = {
    success: true,
    command: 'setup-ci',
    provider,
    ...(workspaceMode ? {
      workspace: true,
      components: workspaceReports.map(({ id, path }) => ({ id, path })),
    } : {}),
    workflowPath,
    requiredSecrets: ['PROMPTFRAME_CI_TOKEN'],
    requiredVariables: ['PROMPTFRAME_API_BASE'],
    ...(workspaceMode ? { optionalVariables: ['RUNNER_LABELS'] } : {}),
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

function promptFrameGithubWorkspaceWorkflow(_components: WorkspaceComponentReport[]): string {
  const apiBaseVariable = '$' + '{{ vars.PROMPTFRAME_API_BASE }}';
  const ciTokenSecret = '$' + '{{ secrets.PROMPTFRAME_CI_TOKEN }}';
  const matrixComponentId = '$' + '{{ matrix.componentId }}';
  const matrixComponentPath = '$' + '{{ matrix.componentPath }}';
  const matrixArtifactName = '$' + '{{ matrix.artifactName }}';
  const runnerLabels = '$' + '{{ vars.RUNNER_LABELS && fromJSON(vars.RUNNER_LABELS) || fromJSON(\'["ubuntu-latest"]\') }}';
  const workspaceMatrixOutput = '$' + '{{ steps.workspace.outputs.matrix }}';
  const workspaceCountOutput = '$' + '{{ steps.workspace.outputs.count }}';
  const discoverMatrix = '$' + '{{ fromJSON(needs.discover.outputs.matrix) }}';
  return `# promptframe-workflow-version: 1
# Generated by promptframe setup-ci --workspace. Keep this header when editing manually.

name: PromptFrame Component Workspace

on:
  pull_request:
  push:
    branches: [main]
    tags:
      - 'v*'
      - '*@*'
      - 'component-*'

permissions:
  contents: read

jobs:
  discover:
    name: Discover PromptFrame components
    runs-on: ${runnerLabels}
    outputs:
      matrix: ${workspaceMatrixOutput}
      count: ${workspaceCountOutput}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - id: workspace
        name: Read promptframe-workspace.json
        run: |
          node <<'NODE'
          const fs = require('node:fs');
          const path = require('node:path');
          const configPath = 'promptframe-workspace.json';
          function fail(message) {
            console.error(message);
            process.exit(1);
          }
          function artifactName(value) {
            return String(value || 'component')
              .replace(/^@/, '')
              .replace(/[^A-Za-z0-9_.-]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'component';
          }
          if (!fs.existsSync(configPath)) {
            fail('promptframe-workspace.json is required for promptframe workspace CI.');
          }
          const workspace = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          const components = Array.isArray(workspace.components) ? workspace.components : [];
          const include = components.map((component, index) => {
            if (!component || typeof component.id !== 'string' || typeof component.path !== 'string') {
              fail('promptframe-workspace.json components[' + index + '] must include string id and path.');
            }
            const manifestPath = path.join(component.path, 'manifest.json');
            if (!fs.existsSync(manifestPath)) {
              fail('Workspace component manifest not found: ' + manifestPath);
            }
            return {
              componentId: component.id,
              componentPath: component.path,
              artifactName: artifactName(component.id),
            };
          });
          const output = process.env.GITHUB_OUTPUT;
          if (!output) fail('GITHUB_OUTPUT is not available.');
          fs.appendFileSync(output, 'matrix=' + JSON.stringify({ include }) + '\\n');
          fs.appendFileSync(output, 'count=' + String(include.length) + '\\n');
          const summary = process.env.GITHUB_STEP_SUMMARY;
          if (summary) {
            const rows = include.map((item) => '- \`' + item.componentId + '\` -> \`' + item.componentPath + '\`');
            fs.appendFileSync(summary, ['### PromptFrame workspace discover', '', '- Components: \`' + include.length + '\`', ...rows, ''].join('\\n'));
          }
          NODE

  check:
    name: PromptFrame check (${matrixComponentId})
    needs: discover
    if: needs.discover.outputs.count != '0'
    runs-on: ${runnerLabels}
    strategy:
      fail-fast: false
      matrix: ${discoverMatrix}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm
      - run: npm install -g pnpm@10
      - run: pnpm install --no-frozen-lockfile
      - name: Validate workspace
        env:
          ARTIFACT_NAME: ${matrixArtifactName}
        run: npx promptframe workspace validate . --json | tee "promptframe-workspace-report-$ARTIFACT_NAME.json"
      - name: Validate component package
        env:
          PROMPTFRAME_API_BASE: ${apiBaseVariable}
          COMPONENT_ID: ${matrixComponentId}
          COMPONENT_PATH: ${matrixComponentPath}
          ARTIFACT_NAME: ${matrixArtifactName}
        run: |
          set +e
          npx promptframe check . --workspace-component "$COMPONENT_ID" --json > "promptframe-check-$ARTIFACT_NAME.json"
          CHECK_EXIT=$?
          set -e
          node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-check-' + process.env.ARTIFACT_NAME + '.json', 'utf8'));
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
              '### PromptFrame workspace check',
              '',
              \`- Component ID: \\\`\${process.env.COMPONENT_ID || payload.source?.workspaceComponentId || 'unknown'}\\\`\`,
              \`- Component path: \\\`\${process.env.COMPONENT_PATH || payload.source?.componentPath || 'unknown'}\\\`\`,
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
          name: promptframe-check-${matrixArtifactName}
          path: |
            promptframe-workspace-report-${matrixArtifactName}.json
            promptframe-check-${matrixArtifactName}.json

  upload:
    name: PromptFrame upload (${matrixComponentId})
    if: github.event_name == 'push' && needs.discover.outputs.count != '0'
    needs: [discover, check]
    runs-on: ${runnerLabels}
    strategy:
      fail-fast: false
      matrix: ${discoverMatrix}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: pnpm
      - run: npm install -g pnpm@10
      - run: pnpm install --no-frozen-lockfile
      - name: Upload component to PromptFrame
        env:
          PROMPTFRAME_API_BASE: ${apiBaseVariable}
          PROMPTFRAME_CI_TOKEN: ${ciTokenSecret}
          COMPONENT_ID: ${matrixComponentId}
          COMPONENT_PATH: ${matrixComponentPath}
          ARTIFACT_NAME: ${matrixArtifactName}
        run: |
          set -euo pipefail
          npx promptframe upload . --workspace-component "$COMPONENT_ID" --endpoint "$PROMPTFRAME_API_BASE" --json | tee "promptframe-upload-$ARTIFACT_NAME.json"
          BUILD_ID=$(node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-upload-' + process.env.ARTIFACT_NAME + '.json', 'utf8'));
          process.stdout.write(String(payload.jobId || payload.buildId || payload.build?.buildId || ''));
          NODE
          )
          if [ -z "$BUILD_ID" ]; then
            echo "PromptFrame upload response did not include a build id." >&2
            exit 1
          fi
          set +e
          npx promptframe status "$BUILD_ID" --endpoint "$PROMPTFRAME_API_BASE" --json --fail-on-build-failed | tee "promptframe-status-$ARTIFACT_NAME.json"
          STATUS_EXIT=\${PIPESTATUS[0]}
          set -e
          node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-upload-' + process.env.ARTIFACT_NAME + '.json', 'utf8'));
          const status = JSON.parse(fs.readFileSync('promptframe-status-' + process.env.ARTIFACT_NAME + '.json', 'utf8'));
          const build = status.build || {};
          const buildId = payload.jobId || payload.buildId || build.buildId || 'unknown';
          const buildStatus = String(build.status || status.status || payload.status || 'queued');
          const diagnostics = Array.isArray(build.diagnostics) ? build.diagnostics : [];
          const firstError = diagnostics.find((item) => item && item.severity === 'error') || diagnostics[0] || {};
          if (['failed', 'cancelled', 'canceled'].includes(buildStatus.toLowerCase())) {
            const message = [
              \`buildId=\${buildId}\`,
              \`status=\${buildStatus}\`,
              firstError.code ? \`code=\${firstError.code}\` : '',
              firstError.message ? \`message=\${String(firstError.message).replace(/\\r?\\n/g, ' ').slice(0, 300)}\` : '',
            ].filter(Boolean).join(' ');
            console.log(\`::error title=PromptFrame platform build failed::\${message}\`);
          }
          const summary = process.env.GITHUB_STEP_SUMMARY;
          if (summary) {
            fs.appendFileSync(summary, [
              '### PromptFrame workspace upload',
              '',
              \`- Component ID: \\\`\${process.env.COMPONENT_ID || payload.source?.workspaceComponentId || 'unknown'}\\\`\`,
              \`- Component path: \\\`\${process.env.COMPONENT_PATH || payload.source?.componentPath || 'unknown'}\\\`\`,
              \`- Diagnostic: \\\`\${payload.diagnostic?.code || 'unknown'}\\\`\`,
              \`- Build ID: \\\`\${buildId}\\\`\`,
              \`- Platform build status: \\\`\${buildStatus}\\\`\`,
              firstError.code ? \`- Top diagnostic: \\\`\${firstError.code}\\\`\` : '- Top diagnostic: none',
              firstError.message ? \`- Message: \${String(firstError.message).replace(/\\r?\\n/g, ' ').slice(0, 300)}\` : '',
              '',
            ].filter(Boolean).join('\\n'));
          }
          NODE
          exit "$STATUS_EXIT"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: promptframe-upload-${matrixArtifactName}
          path: |
            promptframe-upload-${matrixArtifactName}.json
            promptframe-status-${matrixArtifactName}.json
`;
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
          set +e
          npx promptframe status "$BUILD_ID" --endpoint "$PROMPTFRAME_API_BASE" --json --fail-on-build-failed | tee promptframe-status.json
          STATUS_EXIT=\${PIPESTATUS[0]}
          set -e
          node <<'NODE'
          const fs = require('node:fs');
          const payload = JSON.parse(fs.readFileSync('promptframe-upload.json', 'utf8'));
          const status = JSON.parse(fs.readFileSync('promptframe-status.json', 'utf8'));
          const build = status.build || {};
          const buildId = payload.jobId || payload.buildId || build.buildId || 'unknown';
          const buildStatus = String(build.status || status.status || payload.status || 'queued');
          const diagnostics = Array.isArray(build.diagnostics) ? build.diagnostics : [];
          const firstError = diagnostics.find((item) => item && item.severity === 'error') || diagnostics[0] || {};
          if (['failed', 'cancelled', 'canceled'].includes(buildStatus.toLowerCase())) {
            const message = [
              \`buildId=\${buildId}\`,
              \`status=\${buildStatus}\`,
              firstError.code ? \`code=\${firstError.code}\` : '',
              firstError.message ? \`message=\${String(firstError.message).replace(/\\r?\\n/g, ' ').slice(0, 300)}\` : '',
            ].filter(Boolean).join(' ');
            console.log(\`::error title=PromptFrame platform build failed::\${message}\`);
          }
          const summary = process.env.GITHUB_STEP_SUMMARY;
          if (summary) {
            fs.appendFileSync(summary, [
              '### PromptFrame upload',
              '',
              \`- Diagnostic: \\\`\${payload.diagnostic?.code || 'unknown'}\\\`\`,
              \`- Build ID: \\\`\${buildId}\\\`\`,
              \`- Platform build status: \\\`\${buildStatus}\\\`\`,
              firstError.code ? \`- Top diagnostic: \\\`\${firstError.code}\\\`\` : '- Top diagnostic: none',
              firstError.message ? \`- Message: \${String(firstError.message).replace(/\\r?\\n/g, ' ').slice(0, 300)}\` : '',
              '',
            ].filter(Boolean).join('\\n'));
          }
          NODE
          exit "$STATUS_EXIT"
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
  const credential = asRecord(config.credential);
  const projectContext = readProjectContext(argv);
  const endpoint = valueAfter(argv, '--endpoint')
    ?? process.env.PROMPTFRAME_API_BASE
    ?? process.env.REMOTION_MEDIA_API_BASE
    ?? stringValue(config.endpoint)
    ?? stringValue(credential?.endpoint)
    ?? projectContext?.endpoint;
  if (!endpoint) {
    fail(
      `${commandName} requires --endpoint, PROMPTFRAME_API_BASE, REMOTION_MEDIA_API_BASE, local config, or .promptframerc. No default production endpoint is embedded in the public CLI.`,
      `${commandName}.endpoint.missing`,
      2,
    );
  }
  return normalizeEndpoint(endpoint);
}

function resolveOptionalEndpoint(argv: string[]): string | undefined {
  const config = readConfig(argv);
  const credential = asRecord(config.credential);
  const projectContext = readProjectContext(argv);
  const endpoint = valueAfter(argv, '--endpoint')
    ?? stringValue(process.env.PROMPTFRAME_API_BASE)
    ?? stringValue(process.env.REMOTION_MEDIA_API_BASE)
    ?? stringValue(config.endpoint)
    ?? stringValue(credential?.endpoint)
    ?? projectContext?.endpoint;
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
      `Formal PromptFrame endpoints do not accept dev identity headers. Run promptframe login --endpoint ${endpoint}, or set PROMPTFRAME_CI_TOKEN to a scoped CI token and retry without --auth-roles/--auth-permissions.`,
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

function readProjectContext(argv: string[]): PromptFrameProjectContext | undefined {
  const explicitPath = valueAfter(argv, '--project-context');
  const contextPath = explicitPath
    ? resolve(explicitPath)
    : findProjectContextPath(process.cwd());
  if (!contextPath || !existsSync(contextPath)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(contextPath, 'utf8'));
  } catch {
    fail(`PromptFrame project context is not valid JSON: ${contextPath}`, 'project_context.invalid_json', 2);
  }
  return parseProjectContext(raw, contextPath);
}

function findProjectContextPath(startDir: string): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, PROMPTFRAME_PROJECT_CONTEXT_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function parseProjectContext(value: unknown, sourcePath: string): PromptFrameProjectContext {
  const record = asRecord(value);
  if (!record) {
    fail(`PromptFrame project context must be a JSON object: ${sourcePath}`, 'project_context.invalid', 2);
  }
  assertProjectContextSecretFree(record, sourcePath);
  const schemaVersion = stringValue(record.schemaVersion);
  if (schemaVersion && schemaVersion !== PROMPTFRAME_PROJECT_CONTEXT_SCHEMA_VERSION) {
    fail(
      `Unsupported PromptFrame project context schemaVersion ${schemaVersion}. Expected ${PROMPTFRAME_PROJECT_CONTEXT_SCHEMA_VERSION}.`,
      'project_context.schema_unsupported',
      2,
    );
  }
  return {
    schemaVersion: PROMPTFRAME_PROJECT_CONTEXT_SCHEMA_VERSION,
    ...(stringValue(record.endpoint) ? { endpoint: normalizeEndpoint(stringValue(record.endpoint)!) } : {}),
    ...(stringValue(record.tenantId) ? { tenantId: stringValue(record.tenantId)! } : {}),
    ...(stringValue(record.projectId) ? { projectId: stringValue(record.projectId)! } : {}),
    ...(stringValue(record.projectNamespace) ? { projectNamespace: stringValue(record.projectNamespace)! } : {}),
    ...(stringValue(record.defaultUploadTarget) ? { defaultUploadTarget: stringValue(record.defaultUploadTarget)! } : {}),
    ...(stringValue(record.workspaceConfig) ? { workspaceConfig: stringValue(record.workspaceConfig)! } : {}),
  };
}

function buildProjectContext(input: {
  endpoint: string;
  tenantId?: string;
  projectId: string;
  projectNamespace?: string;
  defaultUploadTarget?: string;
  workspaceConfig?: string;
}): PromptFrameProjectContext {
  const context: PromptFrameProjectContext = {
    schemaVersion: PROMPTFRAME_PROJECT_CONTEXT_SCHEMA_VERSION,
    endpoint: normalizeEndpoint(input.endpoint),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    projectId: input.projectId,
    ...(input.projectNamespace ? { projectNamespace: normalizeProjectNamespace(input.projectNamespace) } : {}),
    ...(input.defaultUploadTarget ? { defaultUploadTarget: input.defaultUploadTarget } : {}),
    ...(input.workspaceConfig ? { workspaceConfig: input.workspaceConfig } : {}),
  };
  assertProjectContextSecretFree(context as unknown as Record<string, unknown>, PROMPTFRAME_PROJECT_CONTEXT_FILE_NAME);
  return context;
}

function assertProjectContextSecretFree(value: unknown, sourcePath: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertProjectContextSecretFree(item, sourcePath);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PROJECT_CONTEXT_FORBIDDEN_KEY_NAMES.has(normalizedKey)) {
      fail(
        `PromptFrame project context must not contain secret-bearing field "${key}" in ${sourcePath}. Store tokens in the local CLI config or CI secret store instead.`,
        'project_context.secret_field_forbidden',
        2,
      );
    }
    assertProjectContextSecretFree(child, sourcePath);
  }
}

function assertComponentId(value: string): string {
  if (!/^@[a-z0-9][a-z0-9-]{1,62}\/[a-z0-9][a-z0-9-]{1,62}$/.test(value)) {
    fail(
      `Invalid component id "${value}". Expected @project-namespace/component-slug.`,
      'component.id_invalid',
      2,
    );
  }
  return value;
}

function normalizeProjectNamespace(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalized)) {
    fail(`Invalid project namespace "${value}".`, 'project_context.namespace_invalid', 2);
  }
  return normalized;
}

function displayNameFromComponentId(componentId: string): string {
  const slug = componentId.split('/').at(-1) ?? componentId;
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
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

function validatePreviewProps(dir: string, manifest: ComponentManifest): void {
  const preview = readPreviewProps(dir);
  assertPreviewEnvelope(preview, 'src/preview-props.json', fail);
  assertPreviewPropsMatchStaticSchema(dir, manifest, preview);
}

function readPreviewProps(dir: string): Record<string, unknown> {
  const previewPath = join(dir, 'src/preview-props.json');
  const preview = asRecord(JSON.parse(readFileSync(previewPath, 'utf8')));
  if (!preview) {
    fail('src/preview-props.json must be a JSON object.', 'component_standard.preview.object');
  }
  return preview;
}

function assertPreviewPropsMatchStaticSchema(
  dir: string,
  manifest: ComponentManifest,
  preview: Record<string, unknown>,
): void {
  const previewProps = asRecord(preview.props) ?? {};
  const previewPropNames = Object.keys(previewProps);
  if (previewPropNames.length === 0) return;
  const schemaKeys = extractStaticZodObjectKeys(readIfExists(join(dir, manifest.entry.propsSchemaPath)));
  if (schemaKeys.size === 0) return;
  const unknown = previewPropNames.filter((name) => !schemaKeys.has(name));
  if (unknown.length === 0) return;
  fail(
    `src/preview-props.json props include fields not declared in ${manifest.entry.propsSchemaPath}: ${unknown.join(', ')}`,
    'component_standard.preview_props.unknown_prop',
  );
}

function extractStaticZodObjectKeys(source: string): Set<string> {
  const openBrace = findPropsSchemaZodObjectOpenBrace(source) ?? findFirstZodObjectOpenBrace(source);
  if (openBrace < 0) return new Set();
  const closeBrace = findMatchingBrace(source, openBrace);
  if (closeBrace < 0) return new Set();
  return collectTopLevelObjectKeys(source.slice(openBrace + 1, closeBrace));
}

function findPropsSchemaZodObjectOpenBrace(source: string): number | undefined {
  const propsSchemaMatch = /\bpropsSchema\s*=\s*z\s*\.\s*object\s*\(/.exec(source);
  if (!propsSchemaMatch) return undefined;
  const openParen = source.indexOf('(', propsSchemaMatch.index);
  if (openParen < 0) return undefined;
  const openBrace = nextNonWhitespaceIndex(source, openParen + 1);
  return openBrace >= 0 && source[openBrace] === '{' ? openBrace : undefined;
}

function findFirstZodObjectOpenBrace(source: string): number {
  const objectCallMatch = /\bz\s*\.\s*object\s*\(/.exec(source);
  if (!objectCallMatch) return -1;
  const openParen = source.indexOf('(', objectCallMatch.index);
  if (openParen < 0) return -1;
  const openBrace = nextNonWhitespaceIndex(source, openParen + 1);
  return openBrace >= 0 && source[openBrace] === '{' ? openBrace : -1;
}

function nextNonWhitespaceIndex(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (!/\s/.test(source[index])) return index;
  }
  return -1;
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function collectTopLevelObjectKeys(body: string): Set<string> {
  const keys = new Set<string>();
  let index = 0;
  while (index < body.length) {
    index = skipWhitespaceAndCommas(body, index);
    if (index >= body.length) break;
    if (body.startsWith('...', index)) {
      index = skipTopLevelValue(body, index + 3);
      continue;
    }
    const keyResult = readObjectKey(body, index);
    if (!keyResult) {
      index += 1;
      continue;
    }
    index = skipWhitespaceAndCommas(body, keyResult.nextIndex);
    if (body[index] === ':') {
      keys.add(keyResult.key);
      index = skipTopLevelValue(body, index + 1);
      continue;
    }
    index = keyResult.nextIndex;
  }
  return keys;
}

function skipWhitespaceAndCommas(source: string, start: number): number {
  let index = start;
  while (index < source.length && (/[\s,]/.test(source[index]))) index += 1;
  return index;
}

function readObjectKey(source: string, start: number): { key: string; nextIndex: number } | undefined {
  const char = source[start];
  if (char === '"' || char === '\'') {
    let escaped = false;
    let value = '';
    for (let index = start + 1; index < source.length; index += 1) {
      const current = source[index];
      if (escaped) {
        value += current;
        escaped = false;
        continue;
      }
      if (current === '\\') {
        escaped = true;
        continue;
      }
      if (current === char) return { key: value, nextIndex: index + 1 };
      value += current;
    }
    return undefined;
  }
  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));
  if (!identifier) return undefined;
  return { key: identifier[0], nextIndex: start + identifier[0].length };
}

function skipTopLevelValue(source: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth <= 0) return index + 1;
  }
  return source.length;
}

function skipLineComment(source: string, start: number): number {
  const nextLine = source.indexOf('\n', start);
  return nextLine < 0 ? source.length : nextLine;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf('*/', start);
  return end < 0 ? source.length : end + 1;
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
      const match = source.match(new RegExp(rule.pattern, sourceSafetyRuleFlags(rule.id)));
      if (!match) continue;
      fail(`${entry.name}: ${rule.message} ${rule.repairHint}`, rule.id);
    }
  }
}

function sourceSafetyRuleFlags(ruleId: string): string {
  if (
    ruleId === 'component_standard.source.no_native_img' ||
    ruleId === 'component_standard.source.no_native_video'
  ) {
    return '';
  }
  return 'i';
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
  const lockfiles = collectPackageManagerLockfileEvidence(root);
  if (lockfiles.length === 0) return undefined;
  const packageJson = readFileSync(join(root, 'package.json'));
  const receipt = {
    schemaVersion: LOCKFILE_EVIDENCE_SCHEMA_VERSION,
    packageJsonSha256: sha256Buffer(packageJson),
    lockfiles: lockfiles.map((lockfile) => ({
      fileName: lockfile.name,
      source: lockfile.source,
      relativePath: lockfile.relativePath,
      sizeBytes: lockfile.data.byteLength,
      sha256: sha256Buffer(lockfile.data),
    })),
  };
  return {
    name: LOCKFILE_EVIDENCE_FILE_NAME,
    data: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
  };
}

function collectPackageManagerLockfileEvidence(root: string): PackageManagerLockfileEvidence[] {
  const directLockfiles = collectDirectPackageManagerLockfiles(root);
  if (directLockfiles.length > 0) return directLockfiles;
  const workspaceLockfile = findPnpmWorkspaceRootLockfile(root);
  return workspaceLockfile ? [workspaceLockfile] : [];
}

function collectDirectPackageManagerLockfiles(root: string): PackageManagerLockfileEvidence[] {
  const lockfiles: PackageManagerLockfileEvidence[] = [];
  for (const name of PACKAGE_MANAGER_LOCKFILE_NAMES) {
    const full = join(root, name);
    if (!existsSync(full)) continue;
    lockfiles.push({
      name,
      data: readFileSync(full),
      source: 'component',
      relativePath: name,
    });
  }
  return lockfiles;
}

function findPnpmWorkspaceRootLockfile(root: string): PackageManagerLockfileEvidence | undefined {
  let current = resolve(root);
  while (true) {
    const workspaceConfig = join(current, 'pnpm-workspace.yaml');
    const lockfile = join(current, 'pnpm-lock.yaml');
    if (existsSync(workspaceConfig) && existsSync(lockfile)) {
      return {
        name: 'pnpm-lock.yaml',
        data: readFileSync(lockfile),
        source: 'workspace_root',
        relativePath: relative(root, lockfile).replace(/\\/g, '/'),
      };
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
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

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1);
      if (value) values.push(value);
      continue;
    }
    if (arg !== flag) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) values.push(next);
  }
  return values;
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

function failIfBuildFailed(payload: Record<string, unknown>): void {
  const status = getBuildStatus(payload);
  if (!status || !['failed', 'cancelled', 'canceled'].includes(status.toLowerCase())) return;
  const buildId = getBuildId(payload) ?? 'unknown';
  const diagnosticItem = firstBuildDiagnostic(payload);
  const diagnosticText = diagnosticItem
    ? `${stringValue(diagnosticItem.code) ?? 'unknown'}: ${stringValue(diagnosticItem.message) ?? ''}`.trim()
    : 'no diagnostic';
  fail(
    `PromptFrame platform build failed: buildId=${buildId} status=${status} diagnostic=${diagnosticText}`,
    'status.build.failed',
    1,
  );
}

function getBuildStatus(payload: Record<string, unknown>): string | undefined {
  return stringValue(asRecord(payload.build)?.status) ?? stringValue(payload.status);
}

function firstBuildDiagnostic(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const diagnostics = arrayValue(asRecord(payload.build)?.diagnostics)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  return diagnostics.find((item) => item.severity === 'error') ?? diagnostics[0];
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
    --fail-on-build-failed         Exit nonzero when platform build status is failed/cancelled
  reindex <buildId>                Rebuild component search/evidence indexes
  probe <buildId> --level <level>  Rerun component layout/security probe
  login --endpoint <url>             Start browser login code flow and store a CLI token
    --token <token>                  Verify and store an already issued CLI/CI token
  whoami                            Show the current PromptFrame CLI identity
  logout                            Revoke the current CLI token and clear local config
  discovery                         Fetch platform endpoint and self-service capabilities
  init [dir]                        Write secret-free .promptframerc project context
  project list|current              List accessible projects or show the active project
  component list|create             List or declare Project-scoped components
  ci-token create|list|revoke       Manage self-service CI tokens for the current project
  setup-ci [dir] --provider github   Write a GitHub Actions workflow skeleton
  configure --endpoint <url>       Write local CLI endpoint/context config

Endpoint resolution:
  --endpoint, PROMPTFRAME_API_BASE, REMOTION_MEDIA_API_BASE, local config, then .promptframerc.
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
