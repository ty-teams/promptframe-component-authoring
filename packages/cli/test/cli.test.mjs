import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('dist/index.js');

test('status resolves endpoint from local config and returns platform payload JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-status-'));
  const server = await createServer(async (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/components/marketplace/builds/build-123');
    assert.equal(req.headers['x-tenant-id'], 'tenant-a');
    writeJson(res, {
      success: true,
      build: {
        buildId: 'build-123',
        status: 'succeeded',
        statusUrl: '/admin/components/builds/build-123',
        diagnostics: [{ code: 'component_market.build.succeeded', severity: 'info', message: 'ready' }],
      },
    });
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: server.url,
      tenantId: 'tenant-a',
    }));
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'status',
      'build-123',
      '--json',
      '--config',
      configPath,
    ]);
    const payload = JSON.parse(stdout);
    assert.equal(payload.success, true);
    assert.equal(payload.build.status, 'succeeded');
    assert.equal(payload.command, 'status');
    assert.equal(payload.endpoint, server.url);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing endpoint emits a stable diagnostic code and nonzero exit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-missing-endpoint-'));
  try {
    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'status',
        'build-123',
        '--config',
        path.join(dir, 'missing.json'),
      ], {
        env: {
          ...process.env,
          PROMPTFRAME_API_BASE: '',
          REMOTION_MEDIA_API_BASE: '',
        },
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /status\.endpoint\.missing/);
        assert.match(error.stderr, /No default production endpoint/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload, probe, and reindex call platform transport paths with stable JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-transport-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({ method: req.method, url: req.url, body });
    if (req.url === '/components/marketplace/upload') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers['x-promptframe-upload-target'], 'project_private_generation');
      assert.match(body.toString('latin1'), /fake component zip/);
      writeJson(res, { success: true, jobId: 'build-uploaded', status: 'queued' });
      return;
    }
    if (req.url === '/components/marketplace/builds/build-uploaded/probes/run') {
      assert.equal(req.method, 'POST');
      assert.deepEqual(JSON.parse(body.toString('utf8')), { level: 'standard' });
      writeJson(res, { success: true, probe: { level: 'standard', status: 'ready', diagnostics: [] } });
      return;
    }
    if (req.url === '/components/marketplace/builds/build-uploaded/evidence/reindex') {
      assert.equal(req.method, 'POST');
      assert.deepEqual(JSON.parse(body.toString('utf8')), { providerKind: 'cloud_embedding' });
      writeJson(res, { success: true, evidence: [], providers: [] });
      return;
    }
    res.statusCode = 404;
    writeJson(res, { success: false, error: `unexpected ${req.method} ${req.url}` });
  });
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    const upload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      zipPath,
      '--endpoint',
      server.url,
      '--target',
      'project_private_generation',
      '--json',
    ])).stdout);
    assert.equal(upload.command, 'upload');
    assert.equal(upload.jobId, 'build-uploaded');
    assert.equal(upload.diagnostic.code, 'upload.completed');

    const probe = JSON.parse((await execFileAsync('node', [
      cliPath,
      'probe',
      'build-uploaded',
      '--endpoint',
      server.url,
      '--level',
      'standard',
      '--json',
    ])).stdout);
    assert.equal(probe.command, 'probe');
    assert.equal(probe.probe.status, 'ready');
    assert.equal(probe.diagnostic.code, 'probe.completed');

    const reindex = JSON.parse((await execFileAsync('node', [
      cliPath,
      'reindex',
      'build-uploaded',
      '--endpoint',
      server.url,
      '--provider-kind',
      'cloud_embedding',
      '--json',
    ])).stdout);
    assert.equal(reindex.command, 'reindex');
    assert.equal(reindex.success, true);
    assert.equal(reindex.diagnostic.code, 'reindex.completed');
    assert.deepEqual(calls.map((call) => call.url), [
      '/components/marketplace/upload',
      '/components/marketplace/builds/build-uploaded/probes/run',
      '/components/marketplace/builds/build-uploaded/evidence/reindex',
    ]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects unknown public authoring targets before network transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-target-'));
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'upload',
        zipPath,
        '--endpoint',
        'https://promptframe.invalid/api-proxy',
        '--target',
        'raw_esm_direct',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'upload');
        assert.equal(payload.diagnostic.code, 'upload.target.invalid');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('package validates a component folder and writes a platform zip artifact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-package-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    const out = path.join(dir, 'component.zip');
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      out,
    ]);
    const payload = JSON.parse(stdout);
    assert.equal(payload.command, 'package');
    assert.equal(payload.diagnostic.code, 'package.completed');
    assert.equal(payload.out, out);
    assert.match(payload.sha256, /^sha256:[a-f0-9]{64}$/);
    const zip = await readFile(out);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.match(zip.toString('latin1'), /manifest\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preview exposes a local Remotion preview envelope without a platform endpoint', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const { stdout } = await execFileAsync('node', [
      cliPath,
      'preview',
      componentDir,
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    });
    const payload = JSON.parse(stdout);

    assert.equal(payload.command, 'preview');
    assert.equal(payload.dir, componentDir);
    assert.equal(payload.diagnostic.code, 'preview.ready');
    assert.equal(payload.renderingSystem, 'remotion');
    assert.equal(payload.preview.durationFrames, 60);
    assert.equal(payload.preview.fps, 30);
    assert.equal(payload.preview.width, 1280);
    assert.equal(payload.preview.height, 720);
    assert.deepEqual(payload.preview.props, {});
    assert.deepEqual(payload.localDevCommand, ['npm', 'run', 'dev']);
    assert.equal(payload.previewSource, 'src/preview-props.json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dev prepares a real Remotion Player local preview command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-dev-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const { stdout } = await execFileAsync('node', [
      cliPath,
      'dev',
      componentDir,
      '--host',
      '127.0.0.1',
      '--port',
      '5321',
      '--dry-run',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    });
    const payload = JSON.parse(stdout);

    assert.equal(payload.command, 'dev');
    assert.equal(payload.renderingSystem, 'remotion-player');
    assert.equal(payload.previewSource, 'src/preview-props.json');
    assert.equal(payload.devServer.url, 'http://127.0.0.1:5321');
    assert.deepEqual(payload.devServer.command, [
      'npm',
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '5321',
    ]);
    assert.equal(payload.diagnostic.code, 'dev.ready');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local standard, doctor, and validate expose stable JSON diagnostics', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-local-json-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const standard = JSON.parse((await execFileAsync('node', [
      cliPath,
      'standard',
      '--json',
    ])).stdout);
    assert.equal(standard.command, 'standard');
    assert.equal(standard.diagnostic.code, 'standard.completed');
    assert.deepEqual(standard.supportedComponentTypes, [
      'scene_template',
      'contained_widget',
      'overlay',
      'transition_effect',
    ]);
    assert.equal(standard.authoringStandardRelease.releaseVersion, 'authoring-standard-release.v0.1.0');
    assert.equal(standard.authoringStandardRelease.standardVersion, 'component-standard.v0.1.0');
    assert.match(standard.authoringStandardRelease.standardSourceHash, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(standard.authoringStandardRelease.uploadTargets.map((target) => target.target), [
      'marketplace_authoring',
      'project_private_generation',
    ]);
    assert.equal(standard.freshness.status, 'current');
    assert.equal(standard.freshness.target, 'marketplace_authoring');
    assert.equal(standard.freshness.currentStandardSourceHash, standard.authoringStandardRelease.standardSourceHash);

    const doctor = JSON.parse((await execFileAsync('node', [
      cliPath,
      'doctor',
      '--json',
    ], { cwd: componentDir })).stdout);
    assert.equal(doctor.command, 'doctor');
    assert.equal(doctor.dir, componentDir);
    assert.equal(doctor.diagnostic.code, 'doctor.completed');
    assert.deepEqual(doctor.requiredFiles, [
      'manifest.json',
      'package.json',
      'src/Component.tsx',
      'src/schema.ts',
      'src/index.ts',
      'src/preview-props.json',
    ]);

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.dir, componentDir);
    assert.equal(validate.diagnostic.code, 'validate.completed');
    assert.equal(validate.manifest.id, '@demo/fixture-component');
    assert.equal(validate.manifest.componentType, 'scene_template');
    assert.deepEqual(validate.checkedRuleIds, [
      'manifest.identity.version',
      'manifest.component_type.supported',
      'evidence.schema_source_hash_present',
      'runtime.deterministic.remotion',
      'security.forbidden.browser_apis',
      'security.no_raw_remote_url_import',
      'package.no_parent_imports',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check and upgrade expose freshness and package floor diagnostics', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-upgrade-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const check = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'project_private_generation',
      '--json',
    ])).stdout);
    assert.equal(check.command, 'check');
    assert.equal(check.diagnostic.code, 'check.completed');
    assert.equal(check.freshness.target, 'project_private_generation');
    assert.equal(check.freshness.status, 'current');
    assert.deepEqual(check.checkedRuleIds, [
      'manifest.identity.version',
      'manifest.component_type.supported',
      'evidence.schema_source_hash_present',
      'runtime.deterministic.remotion',
      'security.forbidden.browser_apis',
      'security.no_raw_remote_url_import',
      'package.no_parent_imports',
    ]);

    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.4',
        '@promptframe/component-kit': '^0.1.5',
      },
      devDependencies: {
        '@promptframe/cli': '0.1.5',
      },
    }, null, 2));
    const upgrade = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upgrade',
      componentDir,
      '--dry-run',
      '--json',
    ])).stdout);
    assert.equal(upgrade.command, 'upgrade');
    assert.equal(upgrade.diagnostic.code, 'upgrade.dry_run');
    assert.equal(upgrade.apply, false);
    assert.ok(upgrade.packageChanges.some((change) => (
      change.name === '@promptframe/contracts'
      && change.current === '^0.1.4'
      && change.next === '^0.1.5'
    )));
    assert.ok(upgrade.packageChanges.some((change) => (
      change.name === '@promptframe/component-kit'
      && change.next === '^0.1.6'
    )));
    assert.ok(upgrade.packageChanges.some((change) => (
      change.name === '@promptframe/cli'
      && change.next === '^0.1.6'
    )));

    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.5',
        '@promptframe/component-kit': '^0.1.6',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.10',
      },
    }, null, 2));
    const current = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upgrade',
      componentDir,
      '--dry-run',
      '--json',
    ])).stdout);
    assert.deepEqual(current.packageChanges, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local JSON failures expose diagnostic failure reasons', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-local-json-failure-'));
  try {
    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'doctor',
        '--json',
      ], { cwd: dir }),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'doctor');
        assert.equal(payload.diagnostic.code, 'doctor.required_files.missing');
        assert.match(payload.failureReason, /Missing required files/);
        assert.equal(payload.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor requires the public standard component entrypoint file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-required-files-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await rm(path.join(componentDir, 'src/index.ts'), { force: true });

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'doctor',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'doctor');
        assert.equal(payload.diagnostic.code, 'doctor.required_files.missing');
        assert.match(payload.failureReason, /src\/index\.ts/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects preview props that exceed the public standard limits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/preview-props.json'), JSON.stringify({
      durationFrames: 181,
      fps: 30,
      width: 1280,
      height: 720,
      props: {},
    }));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.preview.duration_frames.max');
        assert.match(payload.failureReason, /durationFrames/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects deterministic source and security policy violations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-source-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  const value = Math.random();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }}>{value}</AbsoluteFill>;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.source.no_math_random');
        assert.match(payload.failureReason, /Math\.random/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate ignores tool config text when checking deterministic component source', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-source-config-text-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'eslint.config.js'), [
      'export default [{',
      '  rules: {',
      '    "no-restricted-syntax": ["error", { message: "Use remotion random(seed) instead of Math.random()." }],',
      '  },',
      '}];',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects deterministic security gate violations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-security-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      "  eval('console.log(1)');",
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }} />;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'code.eval');
        assert.match(payload.failureReason, /eval/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createServer(handler) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 500;
      writeJson(res, { success: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function writeJson(res, payload) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function writeFixtureComponent(componentDir) {
  await writeFileTree(componentDir, {
    'package.json': JSON.stringify({ name: 'fixture-component', version: '0.1.0' }),
    'manifest.json': JSON.stringify({
      schemaVersion: 'component-manifest.v0.1.0',
      standardVersion: 'component-standard.v0.1.0',
      standardSourceHash: `sha256:${'0'.repeat(64)}`,
      id: '@demo/fixture-component',
      name: 'fixture-component',
      displayName: 'Fixture Component',
      version: '0.1.0',
      componentType: 'scene_template',
      author: { id: 'demo', name: 'Demo' },
      description: 'Fixture component used by CLI package tests.',
      tags: ['fixture'],
      designedDurationRange: { min: 30, max: 120 },
      entry: {
        sourcePath: 'src/Component.tsx',
        componentExport: 'default',
        propsSchemaPath: 'src/schema.ts',
        sourceHash: `sha256:${'1'.repeat(64)}`,
        schemaHash: `sha256:${'2'.repeat(64)}`,
      },
      dependencies: {},
      peerDependencies: {},
      assets: {},
      capabilityHints: [],
      reviewStatus: 'draft',
      license: 'MIT',
      createdAt: '2026-05-19T00:00:00.000Z',
    }),
    'src/Component.tsx': [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }} />;',
      '}',
    ].join('\n'),
    'src/schema.ts': 'export const schema = {};\n',
    'src/index.ts': 'export { default } from "./Component";\n',
    'src/preview-props.json': JSON.stringify({ durationFrames: 60, fps: 30, width: 1280, height: 720, props: {} }),
  });
}

async function writeFileTree(root, files) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, `${content}\n`);
  }
}
