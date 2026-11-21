import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const bytes = Buffer.from('original ZIP bytes');
const sha = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const other = 'sha256:' + 'e'.repeat(64);
const target = 'project_private_generation';
const build = (buildId, sourceArchive, uploadTarget = target) => ({buildId, sourceArchive, admission: {uploadTarget}});
const page = (items, nextCursor = null) => ({success: true, items, page: {hasNextPage: Boolean(nextCursor), nextCursor}});

async function fixture(t, pages, args, detail) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push([req.method, url.pathname, url.searchParams.get('cursor')]);
    const output = url.pathname.endsWith('/self/builds') ? pages.shift() : detail;
    res.writeHead(output ? 200 : 403, {'content-type': 'application/json'});
    res.end(JSON.stringify(output ?? {success: false}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'component-source-status-'));
  t.after(() => rm(dir, {force: true, recursive: true}));
  await writeFile(path.join(dir, 'original.zip'), bytes);
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api';
  let output;
  let exitCode = 0;
  const env = {PATH: process.env.PATH, HOME: dir, PROMPTFRAME_CONFIG: path.join(dir, 'config.json')};
  try {
    output = await run(process.execPath, [cli, 'status', ...args, '--endpoint', endpoint, '--json'], {cwd: dir, env});
  } catch (error) {
    exitCode = error.code;
    output = error;
  }
  return {requests, exitCode, text: output.stdout + output.stderr};
}

test('a lost upload acknowledgement can be observed across author pages using the original ZIP', async t => {
  const rewritten = build('original', {sha256: other, submittedSource: {sha256: sha, storedArchiveSha256: other}});
  const pages = [page([build('unrelated', {sha256: other})], 'next page'), page([rewritten])];
  const result = await fixture(t, pages, ['--zip', 'original.zip'], {success: true, build: rewritten});
  assert.equal(result.exitCode, 0, result.text);
  assert.equal(JSON.parse(result.text).buildId, 'original');
  assert.deepEqual(result.requests, [
    ['GET', '/api/components/marketplace/self/builds', null],
    ['GET', '/api/components/marketplace/self/builds', 'next page'],
    ['GET', '/api/components/marketplace/builds/original', null],
  ]);
});

test('the original target disambiguates the same bytes across upload targets', async t => {
  const original = build('private', {sha256: sha});
  const result = await fixture(t, [page([build('market', {sha256: sha}, 'marketplace_authoring'), original])],
    ['--source-sha256=' + sha, '--target', target], {success: true, build: original});
  assert.equal(result.exitCode, 0, result.text);
  assert.equal(JSON.parse(result.text).buildId, 'private');
});

for (const [label, pages, reason] of [
  ['no author match', [page([])], 'unobserved'],
  ['receipt digest without a matching archive', [page([build('other', {sha256: other, submittedSource: {sha256: sha, storedArchiveSha256: sha}})])], 'unobserved'],
  ['multiple original builds', [page([build('a', {sha256: sha})], 'next'), page([build('b', {sha256: sha})])], 'ambiguous'],
  ['a repeated pagination cursor', [page([build('a', {sha256: sha})], 'next'), page([], 'next')], 'incomplete'],
  ['an unreadable author build list', [undefined], 'lookup_failed'],
]) {
  test(label + ' does not select a build or submit another upload', async t => {
    const result = await fixture(t, pages, ['--source-sha256', sha]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.text.includes('status.source.' + reason), result.text);
    assert.ok(result.requests.every(([method, pathname]) => method === 'GET' && pathname.endsWith('/self/builds')));
  });
}
