import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const cli = path.resolve('dist/index.js');

test('command help exits before package, network, child process, or declaration effects', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'promptframe-help-'));
  const guard = path.join(root, 'guard.cjs');
  const config = path.join(root, 'config.json');
  try {
    await writeFile(config, 'invalid configuration: help must not read this');
    await writeFile(guard, `
const fs=require('node:fs'),net=require('node:net'),http=require('node:http'),https=require('node:https'),cp=require('node:child_process');
let calls=0;const deny=()=>{calls++;throw Error('unexpected_help_side_effect');};
for(const k of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync','chmodSync'])fs[k]=deny;
for(const k of ['writeFile','appendFile','mkdir','rename','unlink','rm','chmod'])fs.promises[k]=deny;
for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;
net.Socket.prototype.connect=deny;http.request=deny;https.request=deny;global.fetch=deny;
require('node:module').syncBuiltinESMExports();
process.on('exit',()=>process.stderr.write('HELP_EFFECT_CALLS='+calls+'\\n'));
`);
    const before = (await readdir(root)).sort();
    for (const args of [
      ['upload', '.', '--help'], ['upload', 'missing.zip', '-h'],
      ['package', '.', '--out', 'must-not-exist.zip', '--help'],
      ['component', 'create', '@example/component', '--help'],
      ['ci-token', 'create', '-h'], ['init', '.', '--help'],
      ['configure', '--endpoint', 'https://example.invalid/api', '-h'],
      ['workspace', 'init', '.', '--help'], ['workspace', 'add', '.', '-h'],
      ['setup-ci', '.', '--provider', 'github', '--help'], ['dev', '.', '-h'],
      ['dev', '.', '--studio-origin', 'https://studio.example', '--help'],
      ['status', 'build-example', '--json', '--help'],
    ]) {
      await t.test(args.join(' '), async () => {
        const {stdout, stderr} = await execute(process.execPath, ['--require', guard, cli, ...args], {
          cwd: root,
          env: {PATH: process.env.PATH, PROMPTFRAME_CONFIG: config},
        });
        assert.match(stdout, /Usage: promptframe /);
        assert.match(stdout, new RegExp('Usage: promptframe ' + args[0]));
        assert.equal(stderr, 'HELP_EFFECT_CALLS=0\n');
        assert.deepEqual((await readdir(root)).sort(), before);
        assert.equal(await readFile(config, 'utf8'), 'invalid configuration: help must not read this');
      });
    }
    await t.test('unknown options reject before any handler and do not echo option values', async () => {
      await assert.rejects(execute(process.execPath, ['--require', guard, cli,
        'upload', '.', '--unrecognized=private-value', '--json'], {
        cwd: root, env: {PATH: process.env.PATH, PROMPTFRAME_CONFIG: config},
      }), error => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /cli.option.unknown/);
        assert.match(error.stderr, /HELP_EFFECT_CALLS=0/);
        assert.doesNotMatch(error.stderr, /private-value/);
        return true;
      });
      assert.deepEqual((await readdir(root)).sort(), before);
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
