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
