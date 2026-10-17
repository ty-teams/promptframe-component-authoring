import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { captureDevelopmentModule, startDevelopmentWorkspace } from '../dist/development-workspace.js';
import { developmentFixture } from './fixtures/development-component.mjs';

const origin = 'https://studio.example';
async function workspace(root, count = 3) {
  const modules = [];
  for (let index = 0; index < count; index++) {
    const module = { id: `@demo/part-${index}`, path: `components/part-${index}` };
    const directory = join(root, module.path); await developmentFixture(directory, `title-${index}`);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); manifest.id = module.id;
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await unlink(join(directory, 'pnpm-lock.yaml')); modules.push(module);
  }
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - components/*\n');
  await writeFile(join(root, 'promptframe-workspace.json'), JSON.stringify({ schemaVersion: 'promptframe-workspace.v0.1.0', components: modules }));
  await writeFile(join(root, 'vite.config.ts'), 'throw new Error("child/root config cannot execute");');
  return modules;
}

async function events(server) {
  const controller = new AbortController();
  const response = await fetch(server.url + '/__promptframe/events', { signal: controller.signal,
    headers: { Origin: origin, Authorization: 'Bearer ' + server.credential } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(); let text = '';
  return { close: () => controller.abort(), async wait(predicate) {
    const timer = setTimeout(() => controller.abort(new Error('bounded registry observation timed out')), 20_000);
    try {
      while (true) {
        let boundary;
        while ((boundary = text.indexOf('\n\n')) >= 0) {
          const event = text.slice(0, boundary); text = text.slice(boundary + 2);
          const data = event.split('\n').find(line => line.startsWith('data: '));
          if (data) { const value = JSON.parse(data.slice(6)); if (predicate(value)) return value; }
        }
        const next = await reader.read(); assert.equal(next.done, false);
        text += new TextDecoder().decode(next.value);
      }
    } finally { clearTimeout(timer); }
  } };
}

test('one real root Vite serves three independently checked modules, watches shared lock changes and isolates a failing revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-root-vite-'));
  let server, stream;
  try {
    const modules = await workspace(root);
    server = await startDevelopmentWorkspace({ root, modules, studioOrigin: origin });
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
    stream = await events(server);
    const ready = await stream.wait(value => value.modules.length === 3 && value.modules.every(module => module.status === 'checked'));
    const headers = { Origin: origin, Authorization: 'Bearer ' + server.credential };
    for (const module of ready.modules) {
      const response = await fetch(`${server.url}/__promptframe/modules/${encodeURIComponent(module.moduleId)}/bundle/${module.lastChecked.artifactRevision.slice(7)}`, { headers });
      assert.equal(response.status, 200);
      const bundle = await response.json();
      assert.equal(bundle.sourceRevision, module.sourceRevision);
      assert.equal(bundle.artifactRevision, module.lastChecked.artifactRevision);
      assert.equal(bundle.connectionId, server.connectionId);
      assert.ok(bundle.files.some(file => file.path === 'component.mjs'));
      assert.ok(bundle.files.every(file => !Buffer.from(file.base64, 'base64').includes(server.credential)));
    }
    // The real root lock is in each module's capture, including when a final
    // watcher notification was delayed. No install/lock-integrity is inferred.
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\nsettings: {}\n');
    const expected = new Map(modules.map(module => [module.id, captureDevelopmentModule(root, module).revision]));
    const changed = await stream.wait(value => value.modules.every(module => module.status === 'checked' && module.sourceRevision === expected.get(module.moduleId)));
    assert.ok(changed.modules.every((module, index) => module.sourceRevision !== ready.modules[index].sourceRevision));
    const chart = modules[2], file = join(root, chart.path, 'src/Component.tsx');
    await writeFile(file, await readFile(file, 'utf8') + '\nlocalStorage.getItem("private");');
    const failed = await stream.wait(value => value.modules[2].status === 'failed');
    assert.equal(failed.modules[2].diagnostic, 'storage.browser_storage');
    assert.equal(failed.modules[0].status, 'checked');
    assert.equal(failed.modules[1].status, 'checked');
    assert.notEqual(failed.modules[2].sourceRevision, failed.modules[2].lastChecked.sourceRevision);
    const oldChart = failed.modules[2].lastChecked;
    assert.equal((await fetch(`${server.url}/__promptframe/modules/${encodeURIComponent(chart.id)}/bundle/${oldChart.artifactRevision.slice(7)}`, { headers })).status, 409);
  } finally {
    stream?.close(); if (server) await server.close(); await rm(root, { recursive: true, force: true });
  }
  await assert.rejects(fetch(server.url + '/__promptframe/registry', { signal: AbortSignal.timeout(2000) }));
});

test('the actual HTTP surface requires exact Host, Origin and credential; no raw Vite paths, redirects, writes or wildcard CORS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-root-connection-'));
  let server;
  try {
    const modules = await workspace(root, 1);
    server = await startDevelopmentWorkspace({ root, modules, studioOrigin: origin });
    const headers = { Origin: origin, Authorization: 'Bearer ' + server.credential };
    const read = (path, init = {}) => fetch(server.url + path, { redirect: 'error', ...init, headers: { ...headers, ...init.headers } });
    assert.equal((await read('/__promptframe/registry', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await read('/__promptframe/registry', { headers: { Authorization: 'Bearer ' + 'é'.repeat(64) } })).status, 401);
    const foreign = await read('/__promptframe/registry', { headers: { Origin: 'https://foreign.example' } });
    assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    // Fetch normalizes Host from its URL. Use the actual HTTP client to send
    // this negative instead of mistaking an ignored test header for a bypass.
    const foreignHost = await new Promise((resolve, reject) => {
      const request = httpRequest(server.url + '/__promptframe/registry', { headers: { ...headers, Host: 'foreign.example' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(foreignHost, 403);
    for (const path of ['/@fs/' + root, '/src/Component.tsx', '/vite.config.ts', '/@vite/client']) {
      assert.equal((await read(path)).status, 404);
    }
    assert.equal((await read('/__promptframe/registry?credential=' + server.credential)).status, 400);
    assert.equal((await read('/__promptframe/registry', { method: 'POST' })).status, 405);
    const preflight = await read('/__promptframe/registry', { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    assert.equal((await read('/__promptframe/registry')).status, 200);
  } finally { if (server) { await server.close(); await server.close(); } await rm(root, { recursive: true, force: true }); }
});

test('capture includes actual lock/declaration bytes and rejects symlinks, stale declaration, wrong identity and escaping paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-root-capture-'));
  try {
    const modules = await workspace(root, 1), module = modules[0];
    const first = captureDevelopmentModule(root, module);
    assert.ok(first.readFiles().some(file => file.path === 'pnpm-lock.yaml'));
    assert.ok(first.readFiles().some(file => file.path === 'promptframe-workspace.captured.json'));
    assert.throws(() => captureDevelopmentModule(root, { ...module, path: '../outside' }), /invalid_path/);
    assert.throws(() => captureDevelopmentModule(root, { ...module, path: 'C:/outside' }), /invalid_path/);
    const link = join(root, module.path, 'src/linked.ts');
    await symlink(join(root, module.path, 'src/shared.ts'), link);
    assert.throws(() => captureDevelopmentModule(root, module), /symlink/); await unlink(link);
    const manifestFile = join(root, module.path, 'manifest.json'), rawManifest = await readFile(manifestFile, 'utf8');
    await writeFile(manifestFile, JSON.stringify({ ...JSON.parse(rawManifest), id: '@demo/foreign' }));
    assert.throws(() => captureDevelopmentModule(root, module), /manifest_id_mismatch/);
    await writeFile(manifestFile, rawManifest);
    await writeFile(join(root, 'promptframe-workspace.json'), JSON.stringify({ schemaVersion: 'promptframe-workspace.v0.1.0', components: [] }));
    assert.throws(() => captureDevelopmentModule(root, module), /declaration_changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the actual workspace CLI publishes one real bound connection and joins its server/compiler on normal SIGTERM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-root-cli-'));
  let child, closed, deadline;
  try {
    await workspace(root, 1);
    child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)),
      'dev', root, '--studio-origin', origin, '--port', '0'], {
      cwd: root, env: { NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    const timeout = new Promise((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('bounded CLI lifecycle timed out')), 15_000);
    });
    let text = '', stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const connection = await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => {
          text += chunk;
          if (text.length > 64 * 1024) return reject(new Error('unexpected CLI output'));
          try { resolve(JSON.parse(text)); } catch { /* Wait for one complete JSON object. */ }
        });
      }),
      closed.then(result => assert.fail(JSON.stringify({ ...result, stderr }))),
      timeout,
    ]);
    assert.equal(connection.command, 'dev.workspace'); assert.equal(connection.playerLoaded, false);
    const response = await fetch(connection.url + '/__promptframe/registry', {
      headers: { Origin: origin, Authorization: 'Bearer ' + connection.credential }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200); await response.arrayBuffer();
    child.kill('SIGTERM');
    const result = await Promise.race([closed, timeout]); assert.deepEqual(result, { code: 0, signal: null }, stderr);
    await assert.rejects(fetch(connection.url + '/__promptframe/registry', { signal: AbortSignal.timeout(2000) }));
  } finally {
    clearTimeout(deadline);
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    await rm(root, { recursive: true, force: true });
  }
});
