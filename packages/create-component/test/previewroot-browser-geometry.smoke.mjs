import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');
const createCli = path.join(packageRoot, 'dist/index.js');

test('FB-226 generated PreviewRoot keeps document locked, controls independently scrollable and sticky toolbar stable', { timeout: 300_000 }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'promptframe-previewroot-geometry-'));
  const projectDir = path.join(tempRoot, 'previewroot-geometry-smoke');
  let vite;
  let browser;

  try {
    await run('node', [
      createCli,
      projectDir,
      '--force',
      '--name',
      'previewroot-geometry-smoke',
      '--display-name',
      'PreviewRoot Geometry Smoke',
    ], { cwd: repoRoot });

    await run('pnpm', ['install', '--ignore-workspace', '--prefer-offline'], { cwd: projectDir, timeoutMs: 180_000 });

    const port = await reservePort();
    vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const viteOutput = [];
    vite.stdout.on('data', (chunk) => viteOutput.push(chunk.toString()));
    vite.stderr.on('data', (chunk) => viteOutput.push(chunk.toString()));
    await waitForHttp(`http://127.0.0.1:${port}/`, viteOutput);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 760, height: 420 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-promptframe-preview-player]');
    await page.waitForSelector('[data-promptframe-preview-controls-scroll]');
    await page.waitForSelector('[data-promptframe-preview-aspect-toolbar]');

    const before = await readGeometry(page);
    assert.equal(before.documentCanScroll, false, 'document must not become the scroll container');
    assert.equal(before.controlsCanScroll, true, 'right controls pane should own overflow scrolling');
    assert.ok(before.player.width > 120, `player width should be visible, got ${before.player.width}`);
    assert.ok(before.player.height > 120, `player height should be visible, got ${before.player.height}`);
    assert.ok(rectWithin(before.player, before.stage, 1), 'player should stay inside preview stage');
    assert.notEqual(before.toolbarBackground, 'rgba(0, 0, 0, 0)', 'sticky toolbar needs an opaque background');
    assert.notEqual(before.toolbarZIndex, 'auto', 'sticky toolbar needs explicit z-index');

    await page.locator('[data-promptframe-preview-controls-scroll]').evaluate((node) => {
      node.scrollTop = Math.min(240, node.scrollHeight - node.clientHeight);
    });
    await page.waitForTimeout(100);
    const after = await readGeometry(page);

    assert.equal(after.documentScrollTop, 0, 'scrolling controls must not move the document');
    assert.ok(after.controlsScrollTop > 0, 'controls pane should scroll after programmatic scroll');
    assert.ok(
      Math.abs(after.toolbar.top - before.toolbar.top) <= 1,
      `sticky toolbar top should stay stable, before=${before.toolbar.top}, after=${after.toolbar.top}`,
    );
    assert.ok(
      after.toolbar.top >= after.controls.top - 1 && after.toolbar.bottom <= after.controls.bottom + 1,
      'sticky toolbar should remain clipped within the controls pane',
    );
    assert.ok(rectWithin(after.player, after.stage, 1), 'player should remain inside stage after controls scroll');
  } finally {
    await browser?.close().catch(() => undefined);
    if (vite) {
      vite.kill('SIGTERM');
      await waitForExit(vite, 3_000).catch(() => {
        vite.kill('SIGKILL');
      });
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function readGeometry(page) {
  return page.evaluate(() => {
    const documentElement = document.scrollingElement ?? document.documentElement;
    const controls = mustQuery('[data-promptframe-preview-controls-scroll]');
    const toolbar = mustQuery('[data-promptframe-preview-aspect-toolbar]');
    const stage = mustQuery('[data-promptframe-preview-stage]');
    const player = mustQuery('[data-promptframe-preview-player]');
    const toolbarStyle = getComputedStyle(toolbar);

    return {
      documentCanScroll: documentElement.scrollHeight > documentElement.clientHeight + 1,
      documentScrollTop: documentElement.scrollTop,
      controlsCanScroll: controls.scrollHeight > controls.clientHeight + 1,
      controlsScrollTop: controls.scrollTop,
      controls: rectFor(controls.getBoundingClientRect()),
      toolbar: rectFor(toolbar.getBoundingClientRect()),
      stage: rectFor(stage.getBoundingClientRect()),
      player: rectFor(player.getBoundingClientRect()),
      toolbarBackground: toolbarStyle.backgroundColor,
      toolbarZIndex: toolbarStyle.zIndex,
    };

    function mustQuery(selector) {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`Missing selector ${selector}`);
      return node;
    }

    function rectFor(rect) {
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }
  });
}

function rectWithin(inner, outer, tolerance) {
  return inner.left >= outer.left - tolerance
    && inner.top >= outer.top - tolerance
    && inner.right <= outer.right + tolerance
    && inner.bottom <= outer.bottom + tolerance;
}

async function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms\n${output}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if ((code ?? 0) === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with ${code}\n${output}`));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForExit(child, timeoutMs = 30_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode ?? 0);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`process ${child.pid} did not exit after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(address && typeof address === 'object', 'expected TCP address');
  return address.port;
}

async function waitForHttp(url, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}\n${output.join('')}`);
}
