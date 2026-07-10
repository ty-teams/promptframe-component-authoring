import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AUTHORING_RELEASE_PACKAGES,
  AUTHORING_RELEASE_REGISTRY,
  readAuthoringCandidateManifest,
  readAuthoringReleaseAuthorization,
  validateAuthorizationAgainstCandidate,
  validateCandidateArtifactFiles,
} from './authoring-release-receipt.mjs';

const execFile = promisify(execFileCallback);
const DEPENDENCY_KEYS = Object.freeze({
  contracts: [],
  componentKit: ['contracts'],
  cli: ['contracts', 'componentKit'],
  createComponent: ['contracts', 'componentKit', 'cli'],
});

export async function executeAuthoringPackagePublish(input) {
  const { authorization, candidate, packageKey } = input;
  validateAuthorizationAgainstCandidate(authorization, candidate);
  const packageIndex = AUTHORING_RELEASE_PACKAGES.findIndex((entry) => entry.key === packageKey);
  if (packageIndex < 0) throw new Error('authoring_release.package_key_invalid');
  const packageEntry = candidate.packages[packageIndex];
  const registry = input.registry ?? createNpmRegistryClient();
  const publisher = input.publisher;
  if (!publisher || typeof publisher.publish !== 'function') {
    throw new Error('authoring_release.publisher_required');
  }

  await waitForDependencies({
    packageKey,
    candidate,
    registry,
    maxAttempts: input.maxDependencyAttempts ?? 60,
    sleep: input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    delayMs: input.dependencyDelayMs ?? 5000,
  });

  const before = await registry.readPackage(packageEntry.name);
  const beforeState = classifyRegistryState(before, packageEntry);
  if (beforeState === 'complete') {
    return publishResult(authorization, packageKey, packageEntry, 'already_published');
  }
  if (beforeState !== 'absent') throw new Error('authoring_release.existing_version_not_complete');

  await publisher.publish(packageEntry);
  const after = await registry.readPackage(packageEntry.name);
  if (classifyRegistryState(after, packageEntry) !== 'complete') {
    throw new Error('authoring_release.publish_readback_mismatch');
  }
  return publishResult(authorization, packageKey, packageEntry, 'published');
}

export function createNpmRegistryClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async readPackage(packageName) {
      const response = await fetchImpl(`${AUTHORING_RELEASE_REGISTRY}${encodeURIComponent(packageName)}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`authoring_release.registry_http_${response.status}`);
      return normalizeRegistryMetadata(await response.json());
    },
  };
}

export function createNpmOidcPublisher(options = {}) {
  const artifactRoot = path.resolve(options.artifactRoot);
  const execImpl = options.execFileImpl ?? execFile;
  const env = publishEnvironment(options.baseEnv ?? process.env);
  return {
    async publish(packageEntry) {
      const artifactPath = path.resolve(artifactRoot, packageEntry.artifactName);
      if (path.dirname(artifactPath) !== artifactRoot) throw new Error('authoring_release.artifact_path_invalid');
      try {
        const versionResult = await execImpl('npm', ['--version'], {
          cwd: artifactRoot,
          env,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        });
        assertSupportedNpmVersion(versionResult?.stdout ?? versionResult);
        await execImpl('npm', [
          'publish',
          artifactPath,
          '--tag',
          'latest',
          '--access',
          'public',
          '--ignore-scripts',
          '--registry',
          AUTHORING_RELEASE_REGISTRY,
        ], {
          cwd: artifactRoot,
          env,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
        });
      } catch (error) {
        throw new Error('authoring_release.npm_publish_failed', { cause: error });
      }
    },
  };
}

function assertSupportedNpmVersion(value) {
  const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error('authoring_release.npm_version_invalid');
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
    throw new Error('authoring_release.npm_version_unsupported');
  }
}

async function waitForDependencies(input) {
  const dependencyKeys = DEPENDENCY_KEYS[input.packageKey];
  if (!dependencyKeys) throw new Error('authoring_release.package_key_invalid');
  for (const dependencyKey of dependencyKeys) {
    const index = AUTHORING_RELEASE_PACKAGES.findIndex((entry) => entry.key === dependencyKey);
    const dependency = input.candidate.packages[index];
    let complete = false;
    for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
      if (classifyRegistryState(await input.registry.readPackage(dependency.name), dependency) === 'complete') {
        complete = true;
        break;
      }
      if (attempt + 1 < input.maxAttempts) await input.sleep(input.delayMs);
    }
    if (!complete) throw new Error('authoring_release.dependency_not_complete');
  }
}

function classifyRegistryState(metadata, packageEntry) {
  if (!metadata || !metadata.versions?.[packageEntry.version]) return 'absent';
  const integrity = metadata.versions[packageEntry.version]?.dist?.integrity;
  if (integrity !== packageEntry.integrity) return 'mismatch';
  return metadata.distTags.latest === packageEntry.version ? 'complete' : 'published_without_latest';
}

function normalizeRegistryMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('authoring_release.registry_metadata_invalid');
  }
  const rawTags = value['dist-tags'];
  const rawVersions = value.versions;
  if (!rawTags || typeof rawTags !== 'object' || !rawVersions || typeof rawVersions !== 'object') {
    throw new Error('authoring_release.registry_metadata_invalid');
  }
  return {
    distTags: Object.fromEntries(
      Object.entries(rawTags).filter(([tag, version]) => typeof tag === 'string' && typeof version === 'string'),
    ),
    versions: rawVersions,
  };
}

function publishEnvironment(baseEnv) {
  for (const key of Object.keys(baseEnv)) {
    if (key === 'NODE_AUTH_TOKEN' || /^NPM_.*(?:TOKEN|PASSWORD)$/i.test(key)) {
      throw new Error('authoring_release.long_lived_credential_present');
    }
  }
  return {
    ...baseEnv,
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_LOGLEVEL: 'error',
    NPM_CONFIG_PROVENANCE: 'true',
    NPM_CONFIG_REGISTRY: AUTHORING_RELEASE_REGISTRY,
  };
}

function publishResult(authorization, packageKey, packageEntry, status) {
  return {
    schemaVersion: 'promptframe-authoring-package-publish-result/v1',
    status,
    releaseId: authorization.releaseId,
    releaseDigest: authorization.releaseDigest,
    authorizationDigest: authorization.authorizationDigest,
    packageKey,
    package: {
      name: packageEntry.name,
      version: packageEntry.version,
      integrity: packageEntry.integrity,
    },
    sanitized: true,
  };
}

async function runCli() {
  const root = defaultRoot();
  validateWorkflowContext(root);
  const artifactRoot = path.resolve(process.env.PROMPTFRAME_AUTHORING_RELEASE_ARTIFACT_ROOT ?? '');
  const authorization = await readAuthoringReleaseAuthorization(undefined, { root });
  if (authorization.releaseTag !== process.env.GITHUB_REF_NAME) {
    throw new Error('authoring_release.workflow_tag_mismatch');
  }
  if (process.env.PROMPTFRAME_AUTHORING_RELEASE_PLAN_ONLY === 'true') {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) throw new Error('authoring_release.github_output_missing');
    await appendFile(outputPath, `artifact_tag=${authorization.artifactTag}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'promptframe-authoring-release-download-plan/v1',
      status: 'trusted',
      releaseId: authorization.releaseId,
      releaseDigest: authorization.releaseDigest,
      authorizationDigest: authorization.authorizationDigest,
      artifactTag: authorization.artifactTag,
      sanitized: true,
    })}\n`);
    return;
  }
  const candidate = await readAuthoringCandidateManifest(
    path.join(artifactRoot, 'candidate-manifest.json'),
    { artifactRoot },
  );
  await validateCandidateArtifactFiles(candidate, { artifactRoot });
  if (!isCommitAncestor(candidate.sourceCommit, root)) {
    throw new Error('authoring_release.candidate_source_not_ancestor');
  }
  const result = await executeAuthoringPackagePublish({
    authorization,
    candidate,
    packageKey: process.env.PROMPTFRAME_AUTHORING_RELEASE_PACKAGE_KEY,
    publisher: createNpmOidcPublisher({ artifactRoot }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function validateWorkflowContext(root) {
  if (process.env.GITHUB_EVENT_NAME !== 'push') throw new Error('authoring_release.workflow_event_invalid');
  if (process.env.GITHUB_REPOSITORY !== 'ty-teams/promptframe-component-authoring') {
    throw new Error('authoring_release.workflow_repository_invalid');
  }
  if (!/^refs\/tags\/authoring-release-[A-Za-z0-9._-]+$/.test(process.env.GITHUB_REF ?? '')) {
    throw new Error('authoring_release.workflow_ref_invalid');
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (process.env.GITHUB_SHA !== head) throw new Error('authoring_release.workflow_checkout_mismatch');
}

function isCommitAncestor(commit, root) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli();
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_.-]{3,160}$/i.test(error.message)
      ? error.message
      : 'authoring_release.publish_failed_closed';
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'promptframe-authoring-package-publish-result/v1',
      status: 'failed_closed',
      failure: { code },
      sanitized: true,
    })}\n`);
    process.exitCode = 1;
  }
}
