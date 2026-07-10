import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AUTHORING_RELEASE_PACKAGES,
  createAuthoringCandidateManifest,
  expectedArtifactName,
  readAuthoringReleaseIntent,
  validateCandidateArtifactFiles,
  validateIntentAgainstRepository,
} from './authoring-release-receipt.mjs';

const execFile = promisify(execFileCallback);

export async function buildAuthoringCandidateArtifacts(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot());
  const outputDir = path.resolve(options.outputDir);
  const sourceCommit = String(options.sourceCommit ?? '');
  const artifactTag = String(options.artifactTag ?? '');
  const headCommit = options.headCommit ?? readHeadCommit(root);
  if (sourceCommit !== headCommit) throw new Error('authoring_release.checkout_commit_mismatch');
  const repositoryClean = options.repositoryClean ?? isRepositoryClean(root);
  if (!repositoryClean) throw new Error('authoring_release.repository_not_clean');
  const intent = await readAuthoringReleaseIntent(undefined, { root, now: options.now });
  await validateIntentAgainstRepository(intent, { root });
  if (artifactTag !== intent.artifactTag) throw new Error('authoring_release.workflow_tag_mismatch');
  await mkdir(outputDir, { recursive: false, mode: 0o755 });
  const execImpl = options.execFileImpl ?? execFile;
  const artifacts = [];
  try {
    for (let index = 0; index < AUTHORING_RELEASE_PACKAGES.length; index += 1) {
      const definition = AUTHORING_RELEASE_PACKAGES[index];
      const expected = intent.packages[index];
      const result = await execImpl('npm', [
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        outputDir,
      ], {
        cwd: path.join(root, path.dirname(definition.manifestPath)),
        env: candidatePackEnvironment(options.baseEnv ?? process.env),
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      });
      const pack = parsePackResult(result?.stdout ?? result);
      if (pack.name !== expected.name || pack.version !== expected.version) {
        throw new Error('authoring_release.pack_cohort_mismatch');
      }
      const artifactName = expectedArtifactName(expected.name, expected.version);
      if (pack.filename !== artifactName) throw new Error('authoring_release.pack_filename_mismatch');
      const artifactPath = path.join(outputDir, artifactName);
      artifacts.push({ ...expected, artifactName, bytes: await readFile(artifactPath) });
    }
    const manifest = createAuthoringCandidateManifest({
      intent,
      sourceCommit,
      artifacts,
      createdAt: options.createdAt,
      now: options.now,
    });
    await writeFile(
      path.join(outputDir, 'candidate-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o644 },
    );
    const names = (await readdir(outputDir)).sort();
    const expectedNames = [...manifest.packages.map((entry) => entry.artifactName), 'candidate-manifest.json'].sort();
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      throw new Error('authoring_release.output_files_invalid');
    }
    await validateCandidateArtifactFiles(manifest, { artifactRoot: outputDir });
    return manifest;
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true });
    throw error;
  }
}

function parsePackResult(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ''));
  } catch {
    throw new Error('authoring_release.pack_result_invalid');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
    throw new Error('authoring_release.pack_result_invalid');
  }
  return parsed[0];
}

function candidatePackEnvironment(baseEnv) {
  return Object.fromEntries([
    ['CI', 'true'],
    ['HOME', baseEnv.HOME],
    ['PATH', baseEnv.PATH],
    ['RUNNER_TEMP', baseEnv.RUNNER_TEMP],
    ['TMPDIR', baseEnv.TMPDIR],
    ['NPM_CONFIG_IGNORE_SCRIPTS', 'true'],
    ['NPM_CONFIG_LOGLEVEL', 'error'],
    ['NPM_CONFIG_REGISTRY', 'https://registry.npmjs.org/'],
  ].filter(([, value]) => typeof value === 'string' && value.length > 0));
}

function readHeadCommit(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function isRepositoryClean(root) {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().length === 0;
}

async function runCli() {
  const root = defaultRoot();
  const manifest = await buildAuthoringCandidateArtifacts({
    root,
    outputDir: process.env.PROMPTFRAME_AUTHORING_CANDIDATE_OUTPUT,
    sourceCommit: process.env.GITHUB_SHA,
    artifactTag: process.env.GITHUB_REF_NAME,
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'promptframe-authoring-candidate-build-result/v1',
    status: 'candidate_built',
    releaseId: manifest.releaseId,
    releaseDigest: manifest.releaseDigest,
    manifestDigest: manifest.manifestDigest,
    artifactTag: manifest.artifactTag,
    packages: manifest.packages.map(({ name, version, artifactName, sha256, integrity }) => ({
      name,
      version,
      artifactName,
      sha256,
      integrity,
    })),
    sanitized: true,
  })}\n`);
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
      : 'authoring_release.candidate_build_failed';
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'promptframe-authoring-candidate-build-result/v1',
      status: 'failed_closed',
      failure: { code },
      sanitized: true,
    })}\n`);
    process.exitCode = 1;
  }
}
