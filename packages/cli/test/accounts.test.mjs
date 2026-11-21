import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { COMPONENT_STANDARD_SOURCE_HASH } from '@promptframe/contracts';

const binary = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const invoke = promisify(execFile);
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const identity = account => ({contractVersion: 'promptframe-account-identity/v1',
  platformDigest: hash('fixture-platform'), accountDigest: hash(JSON.stringify(['fixture-tenant', account]))});
const key = account => identity(account).platformDigest.slice(7) + '-' + identity(account).accountDigest.slice(7);
const expiry = '2099-01-01T00:00:00Z';

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'pf-account-test-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const xdg = path.join(home, 'config'), root = path.join(xdg, 'promptframe', 'accounts', 'v1');
  const original = path.join(home, '.promptframe', 'component-authoring.json');
  const calls = [], uploads = [], revoked = new Set();
  const control = {};
  const server = createServer(async (req, res) => {
    const token = req.headers.authorization?.slice(7) ?? '';
    const account = token.match(/^test-only-([AB])(?:-renewed)?$/)?.[1];
    calls.push({path: req.url, account});
    const reply = (value, code = 200) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(value)); };
    if (req.url === '/api/cli/discovery') return reply({accountIdentityBinding: {
      contractVersion: identity('A').contractVersion, platformDigest: identity('A').platformDigest, deviceStartField: 'expectedIdentity',
      uploadHeader: 'X-PromptFrame-Expected-Identity', credentialIdentityField: 'accountIdentity'}});
    if (!account || revoked.has(token)) return reply({success:false}, 401);
    if (req.url === '/api/cli/auth/whoami') {
      if (control.waitForWhoami) await control.waitForWhoami();
      return reply({success:true, accountIdentity: identity(control.observed ?? account), revoked:false, expiresAt:expiry,
        scopes:['component.status.read', 'component.upload'], allowedUploadTargets:['project_private_generation'],
        principal:{tenantId:'fixture-tenant', userId:account, projectId:'same-project'}, tokenKind:'human', tokenId:'grant-' + account});
    }
    if (req.url === '/api/cli/auth/logout') { revoked.add(token); return reply({success:true}); }
    if (req.url === '/api/components/standard') {
      if (control.waitForStandard) await control.waitForStandard();
      return reply({success:true, sourceHash:COMPONENT_STANDARD_SOURCE_HASH});
    }
    if (req.url === '/api/components/marketplace/upload') {
      let bytes = 0; for await (const chunk of req) bytes += chunk.length;
      uploads.push({account, original: token === 'test-only-' + account, expected: JSON.parse(req.headers['x-promptframe-expected-identity']), bytes});
      return reply({success:true, buildId:'build-' + account});
    }
    return reply({success:false}, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api';
  const execute = (args, env = {}) => invoke(process.execPath, [binary, ...args, '--json'],
    {env:{PATH:process.env.PATH, HOME:home, XDG_CONFIG_HOME:xdg, ...env}, timeout:15000});
  const run = async (...args) => JSON.parse((await execute(args)).stdout);
  const login = (id, ...args) => run('login', '--endpoint', endpoint, '--token', 'test-only-' + id, ...args);
  // Public Creation v1 reference shape. The CLI only reads this metadata and never reads a Creation credential.
  async function creationGrant(account) {
    const id = identity(account), configFile = path.join(home, 'creation', account + '.json');
    const referenceId = hash(JSON.stringify(['creation', configFile]));
    const dir = path.join(root,'identities',id.platformDigest.slice(7),id.accountDigest.slice(7),'creation');
    await mkdir(dir, {recursive:true, mode:0o700});
    await writeFile(path.join(dir, referenceId.slice(7) + '.json'), JSON.stringify({
      contractVersion:'promptframe-local-account-directory/v1', identity:id, client:'creation', configFile, referenceId,
      endpoint:endpoint + '/mcp', credentialDigest:hash('fixture-creation-reference'), observedAt:new Date().toISOString(), profile:account,
    }), {mode:0o600});
  }
  return {home, root, original, endpoint, calls, uploads, control, execute, run, login, creationGrant};
}

function failure(code) {
  return error => {
    const row = JSON.parse(error.stderr);
    assert.equal(row.diagnostic.code, code);
    assert.doesNotMatch(error.stderr + error.stdout, /test-only-[AB]|credentialDigest|configFile/);
    return true;
  };
}

test('two client types group by authenticated identity, repeated bare login preserves the other account', async t => {
  const f = await fixture(t);
  await f.creationGrant('A');
  const first = await f.login('A'), original = await readFile(f.original);
  const second = await f.login('B'), renewal = await f.login('B-renewed');
  assert.equal(first.accountDirectory.identityKey, key('A'));
  assert.equal(second.accountDirectory.referenceId, renewal.accountDirectory.referenceId);
  assert.deepEqual(await readFile(f.original), original);
  const list = await f.run('accounts', 'list');
  assert.equal(list.complete, true); assert.equal(list.accounts.length, 2);
  const a = list.accounts.find(row => row.identityKey === key('A'));
  assert.equal(a.grants.creation.length, 1); assert.equal(a.grants['component-cli'].length, 1);
  assert.deepEqual(a.missingClients, []);
  const b = list.accounts.find(row => row.identityKey === key('B'));
  assert.equal(b.grants['component-cli'].length, 1); assert.deepEqual(b.missingClients, ['creation']);
  assert.ok(!JSON.stringify(list).includes(f.home));
  assert.doesNotMatch(JSON.stringify(list), /test-only-|credentialDigest|configFile/);
  const folder = path.join(f.root,'identities',a.identity.platformDigest.slice(7),a.identity.accountDigest.slice(7),'component-cli');
  const [file] = await readdir(folder), ref = path.join(folder, file);
  assert.equal((await stat(ref)).mode & 0o777, 0o600); assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.doesNotMatch(await readFile(ref, 'utf8'), /test-only-/);
  const before = f.calls.length;
  await assert.rejects(f.run('whoami'), failure('cli.accounts.account_required'));
  assert.equal(f.calls.length, before);
  const verified = JSON.parse((await f.execute(['accounts', 'verify', '--account', key('A')], {PROMPTFRAME_CI_TOKEN:'test-only-B'})).stdout);
  assert.deepEqual(verified.accountIdentity, identity('A'));
  await f.run('logout', '--account', key('B'));
  assert.deepEqual(await readFile(f.original), original);
  assert.deepEqual((await f.run('accounts','list')).accounts.find(row => row.identityKey === key('B')).grants['component-cli'], []);
  assert.deepEqual((await f.run('whoami')).accountIdentity, identity('A'));
});

test('a targeted first login needs a known platform and never rebinds another profile', async t => {
  const f = await fixture(t);
  await f.login('A'); await f.creationGrant('B');
  const before = f.calls.length;
  await assert.rejects(f.run('login','--account',key('C'),'--endpoint',f.endpoint), failure('cli.accounts.unknown'));
  await assert.rejects(f.run('login','--account',key('B'),'--endpoint',f.endpoint + '/other'), failure('cli.auth.platform_mismatch'));
  await assert.rejects(f.run('login','--account',key('B'),'--config',f.original), failure('cli.accounts.config_in_use'));
  assert.equal(f.calls.length, before);
  const login = await f.login('B','--account',key('B'));
  const ref = path.join(f.root,'identities',identity('B').platformDigest.slice(7),identity('B').accountDigest.slice(7),
    'component-cli', login.accountDirectory.referenceId.slice(7) + '.json');
  const data = JSON.parse(await readFile(ref)); data.expiresAt = '2000-01-01T00:00:00Z';
  await writeFile(ref, JSON.stringify(data));
  const registered = (await f.run('accounts','list')).accounts.find(row => row.identityKey === key('B'));
  assert.equal(registered.grants['component-cli'][0].status, 'expired');
  const after = f.calls.length;
  await assert.rejects(f.run('upload','missing.zip','--account',key('B')), failure('cli.auth.login_required'));
  assert.equal(f.calls.length, after);
});

test('simultaneous first logins preserve both grants in an already configured CLI', async t => {
  const f = await fixture(t);
  await f.run('configure','--endpoint',f.endpoint);
  let arrivals = 0, resume;
  const both = new Promise(resolve => { resume = resolve; });
  f.control.waitForWhoami = async () => { if (++arrivals === 2) resume(); await both; };
  await Promise.all([f.login('A'), f.login('B')]);
  delete f.control.waitForWhoami;
  const rows = (await f.run('accounts', 'list')).accounts;
  assert.equal(rows.length, 2);
  for (const account of ['A','B']) {
    assert.equal(rows.find(row => row.identityKey === key(account)).grants['component-cli'].length, 1);
    assert.deepEqual((await f.run('accounts','verify','--account',key(account))).accountIdentity, identity(account));
  }
  assert.ok(!(await readdir(path.dirname(f.original))).some(name => name.startsWith('.promptframe-account-')));
});

test('missing CLI grant, changed config, unsafe file and wrong returned principal stop before upload', async t => {
  const f = await fixture(t);
  await f.login('A'); await f.creationGrant('B');
  const before = f.calls.length;
  await assert.rejects(f.execute(['upload','missing.zip','--account',key('B')],{PROMPTFRAME_CI_TOKEN:'test-only-A'}), failure('cli.accounts.credential_missing'));
  await assert.rejects(f.run('accounts','verify','--account',key('A'),'--endpoint',f.endpoint + '/wrong'), failure('cli.auth.platform_mismatch'));
  await assert.rejects(f.execute(['accounts','switch',key('B'),'--session-id','fixture-id'],{CODEX_THREAD_ID:'fixture-id'}), failure('cli.accounts.host_unverified'));
  assert.equal(f.calls.length, before);
  f.control.observed = 'B';
  await assert.rejects(f.run('upload','missing.zip','--account',key('A')), failure('cli.auth.account_mismatch'));
  delete f.control.observed;
  const saved = JSON.parse(await readFile(f.original)); saved.credential.tokenSecret = 'test-only-B';
  await writeFile(f.original, JSON.stringify(saved), {mode:0o600});
  const after = f.calls.length;
  await assert.rejects(f.run('accounts','verify','--account',key('A')), failure('cli.accounts.reference_changed'));
  await chmod(f.original, 0o644);
  await assert.rejects(f.run('accounts','refresh','--config',f.original), failure('cli.accounts.directory_invalid'));
  assert.equal(f.calls.length, after); assert.deepEqual(f.uploads, []);
});

test('two grants of one account require an explicit grant when no matching profile was selected', async t => {
  const f = await fixture(t);
  const one = path.join(f.home,'profile-one.json'), two = path.join(f.home,'profile-two.json');
  const a = await f.login('A','--config',one); await f.login('A-renewed','--config',two);
  const before = f.calls.length;
  await assert.rejects(f.run('accounts','verify','--account',key('A')), failure('cli.accounts.reference_required'));
  assert.equal(f.calls.length, before);
  const verified = await f.run('accounts','verify','--account',key('A'),'--reference-id',a.accountDirectory.referenceId);
  assert.deepEqual(verified.accountIdentity, identity('A'));
  assert.equal((await f.run('accounts','refresh','--config',two)).status, 'stored');
});

test('two shell invocations can select opposite accounts and an old upload pins its original token through rotation', async t => {
  const f = await fixture(t);
  await f.login('A'); await f.login('B');
  const zip = path.join(f.home,'fixture.zip'); await writeFile(zip,'fixture component');
  let signalEntered, releaseStandard;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const resume = new Promise(resolve => { releaseStandard = resolve; });
  f.control.waitForStandard = async () => { signalEntered(); await resume; };
  const upload = f.run('upload',zip,'--account',key('A'));
  try {
    await Promise.race([entered, upload.then(()=>{throw Error('expected pending upload');})]);
    const checks = await Promise.all(['A','B'].map(async id =>
      JSON.parse((await f.execute(['whoami'], {PROMPTFRAME_ACCOUNT:key(id)})).stdout).accountIdentity));
    assert.deepEqual(checks, [identity('A'), identity('B')]);
    await f.login('A-renewed');
  } finally { releaseStandard(); }
  assert.equal((await upload).jobId, 'build-A');
  assert.equal(f.uploads.length, 1); assert.equal(f.uploads[0].original, true);
  assert.deepEqual(f.uploads[0].expected, identity('A'));
  assert.ok(f.uploads[0].bytes > 0);
});
