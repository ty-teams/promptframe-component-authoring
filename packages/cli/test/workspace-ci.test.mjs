import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectWorkspaceCi } from '../dist/workspace-ci.js';

const alpha = { id: '@demo/alpha', path: 'works/film/components/alpha' };
const beta = { id: '@demo/beta', path: 'components/diagram/beta' };
const config = components => ({ schemaVersion: 'promptframe-workspace.v0.1.0', components });
const ids = matrix => matrix.include.map(entry => entry.componentId);

function repo(t, initial) {
  const root = mkdtempSync(join(tmpdir(), 'promptframe-ci-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), value);
  };
  const save = workspace => write('promptframe-workspace.json', JSON.stringify(workspace));
  const commit = () => {
    git('add', '--', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  save(initial);
  for (const entry of initial.components) {
    write(`${entry.path}/manifest.json`, JSON.stringify({ id: entry.id, version: '1.0.0' }));
    write(`${entry.path}/package-lock.json`, '{}');
    write(`${entry.path}/source.ts`, 'same bytes');
  }
  return { root, write, save, commit, base: commit() };
}

test('workspace CI selects changed and deleted inputs with no components/** assumption', t => {
  const workspace = config([alpha, beta]);
  const f = repo(t, workspace);
  f.write('notes/README.md', 'unrelated');
  const last = f.commit();
  assert.deepEqual(ids(selectWorkspaceCi(f.root, workspace, { name: 'push', before: f.base }).matrix), []);

  rmSync(join(f.root, alpha.path, 'source.ts'));
  f.commit();
  const push = selectWorkspaceCi(f.root, workspace, { name: 'push', before: last });
  assert.deepEqual(ids(push.matrix), [alpha.id]);
  assert.deepEqual(ids(push.uploadMatrix), [alpha.id]);
  const pr = selectWorkspaceCi(f.root, workspace, { name: 'pull_request', before: last });
  assert.deepEqual(ids(pr.matrix), [alpha.id]);
  assert.deepEqual(ids(pr.uploadMatrix), []);
  const firstPush = selectWorkspaceCi(f.root, workspace, { name: 'push', before: '0'.repeat(40) });
  assert.deepEqual(ids(firstPush.matrix), [alpha.id, beta.id]);
  assert.deepEqual(ids(firstPush.uploadMatrix), []);
});

test('workspace CI checks a proven empty move, and retains uploads for content or shared layout changes', t => {
  const workspace = config([alpha, beta]);
  const f = repo(t, workspace);
  const moved = { ...alpha, path: 'works/next/components/alpha' };
  const after = config([moved, beta]);
  mkdirSync(dirname(join(f.root, moved.path)), { recursive: true });
  renameSync(join(f.root, alpha.path), join(f.root, moved.path));
  f.save(after);
  f.commit();
  const beforeEdit = selectWorkspaceCi(f.root, after, { name: 'push', before: f.base });
  assert.deepEqual(ids(beforeEdit.matrix), [alpha.id]);
  assert.deepEqual(ids(beforeEdit.uploadMatrix), []);

  f.write(`${moved.path}/source.ts`, 'changed bytes');
  const afterEdit = f.commit();
  assert.deepEqual(ids(selectWorkspaceCi(f.root, after, { name: 'push', before: f.base }).uploadMatrix), [alpha.id]);
  const shared = { ...after, sharedDirectories: ['shared'] };
  f.save(shared);
  f.write('shared/source.ts', 'shared input');
  const last = f.commit();
  assert.deepEqual(ids(selectWorkspaceCi(f.root, shared, { name: 'push', before: afterEdit }).uploadMatrix), [alpha.id, beta.id]);
  f.write('pnpm-lock.yaml', 'lockfileVersion: 9');
  f.commit();
  assert.deepEqual(ids(selectWorkspaceCi(f.root, shared, { name: 'push', before: last }).matrix), [alpha.id, beta.id]);
});

test('manual and tag uploads require a single registered component', t => {
  const sameSlug = { id: '@another/alpha', path: 'components/media/second-alpha' };
  const workspace = config([alpha, beta, sameSlug]);
  const f = repo(t, workspace);
  assert.deepEqual(ids(selectWorkspaceCi(f.root, workspace, { name: 'workflow_dispatch', component: alpha.id }).uploadMatrix), []);
  assert.deepEqual(ids(selectWorkspaceCi(f.root, workspace, { name: 'workflow_dispatch', component: alpha.id, upload: true }).uploadMatrix), [alpha.id]);
  assert.throws(() => selectWorkspaceCi(f.root, workspace, { name: 'workflow_dispatch', component: 'alpha' }), /full ID/);
  assert.throws(() => selectWorkspaceCi(f.root, workspace, { name: 'workflow_dispatch', upload: true }), /full ID/);
  assert.deepEqual(ids(selectWorkspaceCi(f.root, workspace, { name: 'push', ref: 'refs/tags/v1.0.0' }).uploadMatrix), []);
  assert.deepEqual(ids(selectWorkspaceCi(f.root, workspace, { name: 'push', ref: 'refs/tags/component-alpha-v1.0.0' }).uploadMatrix), []);
  assert.deepEqual(ids(selectWorkspaceCi(f.root, workspace, { name: 'push', ref: 'refs/tags/component-beta-v1.0.0' }).uploadMatrix), [beta.id]);
});

test('workspace ci-select reads the pull request base from the GitHub event file', t => {
  const workspace = config([alpha, beta]);
  const f = repo(t, workspace);
  f.write(`${beta.path}/source.ts`, 'updated');
  f.commit();
  f.write('github-event.json', JSON.stringify({ pull_request: { base: { sha: f.base } } }));
  const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const plan = JSON.parse(execFileSync(process.execPath, [cli, 'workspace', 'ci-select', '.'], {
    cwd: f.root,
    env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(f.root, 'github-event.json') },
    encoding: 'utf8',
  }));
  assert.deepEqual(ids(plan.matrix), [beta.id]);
  assert.deepEqual(ids(plan.uploadMatrix), []);
});
