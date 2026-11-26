import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {terminalDiagnostic, terminalLanguage, terminalOutput} from '../dist/terminal-language.js';
import {PROMPTFRAME_AUTHORING_STANDARD_RELEASE as release} from '../dist/authoring-release.js';
import {COMPONENT_STANDARD_SOURCE_HASH, evaluatePromptFrameLayoutPolicy} from '@promptframe/contracts';
import {evaluatePromptFrameLayoutPolicy as evaluateAstLayout} from '@promptframe/contracts/layout-evaluator';

const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, '../dist/index.js');
const environment = (dir, locale = {}) => {
  const env = {...process.env};
  for (const key of ['PROMPTFRAME_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG', 'PROMPTFRAME_API_BASE',
    'REMOTION_MEDIA_API_BASE', 'PROMPTFRAME_CLI_TOKEN', 'PROMPTFRAME_CI_TOKEN', 'PROMPTFRAME_ACCOUNT',
    'PROMPTFRAME_ACCOUNT_DIRECTORY', 'PROMPTFRAME_AUTH_TOKEN']) delete env[key];
  return {...env, XDG_CONFIG_HOME: dir, PROMPTFRAME_CONFIG: path.join(dir, 'config.json'), ...locale};
};

test('installed terminal standard and doctor select Chinese without changing machine fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-terminal-language-'));
  try {
    const run = (args, locale) => exec(process.execPath, [cli, ...args], {env: environment(dir, locale)});
    const english = JSON.parse((await run(['standard', '--json'], {LANG: 'en_US.UTF-8'})).stdout);
    const chinese = JSON.parse((await run(['standard', '--json'], {LANG: 'zh_CN.UTF-8'})).stdout);
    assert.match(chinese.freshness.diagnostic.message, /本地.*标准/);
    assert.match(english.freshness.diagnostic.message, /Local authoring standard/);
    assert.equal(chinese.standardSourceHash, english.standardSourceHash);
    assert.deepEqual(chinese.recommendedAuthoringPackages, english.recommendedAuthoringPackages);
    assert.equal(chinese.freshness.diagnostic.code, english.freshness.diagnostic.code);
    await assert.rejects(run(['doctor', dir, '--json'], {LANG: 'zh_CN.UTF-8'}), error => {
      const result = JSON.parse(error.stderr);
      assert.equal(error.code, 1);
      assert.equal(result.diagnostic.code, 'doctor.required_files.missing');
      assert.match(result.diagnostic.message, /缺少必需文件/);
      assert.equal(result.failureReason, result.diagnostic.message);
      return true;
    });
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('locale priority, empty values, English/default and unsupported locale fallbacks', () => {
  assert.equal(terminalLanguage({}), 'en');
  for (const value of ['en', 'en_GB.UTF-8', 'C', 'POSIX', 'fr_FR', 'invalid']) {
    assert.equal(terminalLanguage({LC_ALL: value, LANG: 'zh_CN'}), 'en');
  }
  for (const value of ['zh', 'zh_CN.UTF-8', 'zh-TW', 'ZH_hant']) assert.equal(terminalLanguage({LANG: value}), 'zh');
  assert.equal(terminalLanguage({PROMPTFRAME_LANG: 'en', LC_ALL: 'zh_CN'}), 'en');
  assert.equal(terminalLanguage({PROMPTFRAME_LANG: '  ', LC_ALL: '', LC_MESSAGES: 'zh_TW', LANG: 'en'}), 'zh');
});

async function fixture(dir) {
  const component = path.join(dir, 'component');
  await cp(path.resolve(import.meta.dirname, '../../create-component/templates/react-remotion'), component, {recursive: true});
  const file = path.join(component, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  Object.assign(manifest, {id: '@demo/terminal-language', name: 'terminal-language', displayName: 'Terminal language', description: 'Terminal language fixture'});
  await writeFile(file, JSON.stringify(manifest));
  await writeFile(path.join(component, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');
  return {component, manifest};
}

test('doctor, upgrade and stale scaffold human/JSON messages preserve commands, codes and writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-terminal-doctor-'));
  try {
    const {component} = await fixture(dir);
    await mkdir(path.join(component, '.promptframe'), {recursive: true});
    await writeFile(path.join(component, '.promptframe/scaffold.json'), JSON.stringify({schemaVersion: 'promptframe.scaffold.v0.1.0',
      createdByPackage: 'create-promptframe-component', createdByVersion: '0.0.1', templateName: 'react-remotion'}));
    const run = (args, lang = 'zh') => exec(process.execPath, [cli, ...args], {env: environment(dir, {PROMPTFRAME_LANG: lang})});
    const doctor = JSON.parse((await run(['doctor', component, '--json'])).stdout);
    assert.equal(doctor.diagnostic.code, 'doctor.completed'); assert.match(doctor.diagnostic.message, /必需/);
    const stale = doctor.diagnostics.find(row => row.code === 'scaffold.template.stale');
    assert.match(stale.message, /脚手架模板已过时/);
    assert.ok(stale.repairHint.includes('promptframe upgrade . --check-latest'));
    const human = (await run(['doctor', component])).stdout;
    assert.match(human, /doctor 检查通过/); assert.match(human, /scaffold.template.stale: PromptFrame 脚手架/);
    const pkg = path.join(component, 'package.json'), before = await readFile(pkg, 'utf8');
    const dry = JSON.parse((await run(['upgrade', component, '--dry-run', '--check-latest', '--json'])).stdout);
    assert.equal(dry.diagnostic.code, 'upgrade.dry_run'); assert.match(dry.diagnostic.message, /未写入/);
    assert.equal(await readFile(pkg, 'utf8'), before);
    assert.match((await run(['upgrade', component, '--dry-run'])).stdout, /upgrade 预览变更/);
    const applied = JSON.parse((await run(['upgrade', component, '--apply', '--json'])).stdout);
    assert.equal(applied.diagnostic.code, 'upgrade.applied'); assert.match(applied.diagnostic.message, /已更新/);
    const en = JSON.parse((await run(['doctor', component, '--json'], 'en')).stdout);
    assert.match(en.diagnostic.message, /required authoring files/);
    for (const [args, code, exit, pattern] of [
      [['upgrade', component, '--apply', '--dry-run'], 'upgrade.mode.conflict', 2, /不能同时/],
      [['upgrade', dir], 'upgrade.package_json.missing', 1, /需要 package.json/],
    ]) {
      await assert.rejects(run([...args, '--json']), error => {
        const row = JSON.parse(error.stderr); assert.equal(error.code, exit); assert.equal(row.diagnostic.code, code);
        assert.match(row.diagnostic.message, pattern); return true;
      });
    }
    await writeFile(path.join(dir, 'package.json'), '{');
    await assert.rejects(run(['upgrade', dir]), error => {
      assert.equal(error.code, 1); assert.match(error.stderr, /upgrade.package_json.invalid:.*有效的 JSON/); return true;
    });
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('layout/style output localizes real evaluator results and leaves source locations and business data intact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-terminal-layout-'));
  try {
    const {component, manifest} = await fixture(dir);
    const source = 'export default () => <div style={{width: 400, height: 300}}/>;';
    await writeFile(path.join(component, 'src/Component.tsx'), source);
    let fixed;
    await assert.rejects(exec(process.execPath, [cli, 'validate', component, '--json'],
      {env: environment(dir, {LANG: 'zh_CN'})}), error => {
      assert.equal(error.code, 1); fixed = JSON.parse(error.stderr).diagnostic; return true;
    });
    assert.equal(fixed.code, 'component.layout.root_fixed_size');
    assert.match(fixed.message, /src\/Component.tsx:\d+:\d+: 样式固定了最终宽高/);
    assert.match(fixed.repairHint, /父级槽/);
    await assert.rejects(exec(process.execPath, [cli, 'validate', component], {env: environment(dir, {LANG: 'zh_CN'})}), error => {
      assert.equal(error.code, 1); assert.match(error.stderr, /component.layout.root_fixed_size: .*样式固定了最终宽高/); return true;
    });
    const rows = [{...manifest, layout: undefined}, {...manifest, layout: {}}]
      .flatMap(value => evaluatePromptFrameLayoutPolicy({manifest: value}).diagnostics);
    for (const componentSourceText of [source, 'export default () => <div style={{width: "100vw"}}/>;', 'export default () => <div style={{']) {
      rows.push(...evaluateAstLayout({manifest, componentSourceText}).diagnostics);
    }
    rows.push(...evaluatePromptFrameLayoutPolicy({manifest, styleSourceText: 'body { color: red; }'}).diagnostics);
    for (const row of rows) {
      assert.equal(terminalDiagnostic(row, 'zh').code, row.code);
      assert.notEqual(terminalDiagnostic(row, 'zh').message, row.message, row.code);
      assert.deepEqual(terminalDiagnostic(row, 'en'), row);
    }
    const unknownStyle = {code: 'future.rule', severity: 'warning', message: 'Unrecognized future diagnostic.'};
    assert.deepEqual(terminalDiagnostic(unknownStyle, 'zh'), unknownStyle);
    const business = {diagnostic: unknownStyle, props: {color: 'red', message: unknownStyle.message}};
    const output = {diagnostic: fixed, diagnostics: rows, freshness: {diagnostic: unknownStyle}, data: business, manifest: business};
    const original = structuredClone(output), localized = terminalOutput(output, 'zh');
    assert.deepEqual(output, original); assert.deepEqual(localized.data, business); assert.deepEqual(localized.manifest, business);
    assert.deepEqual(localized.diagnostic, fixed);
    assert.equal(localized.freshness.diagnostic.message, unknownStyle.message);
    assert.deepEqual(terminalDiagnostic({code: 'future.rule', message: 'Unrecognized text'}, 'zh'), {code: 'future.rule', message: 'Unrecognized text'});
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('real standard version branches keep policy decisions and repair commands identical in both languages', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-terminal-versions-'));
  const calls = [], versions = release.recommendedAuthoringPackages;
  let payload;
  const server = http.createServer((req, res) => {
    calls.push([req.method, req.url]); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const {component} = await fixture(dir), endpoint = `http://127.0.0.1:${server.address().port}`;
    const old = Object.fromEntries(Object.keys(versions).map(key => [key, '0.0.1']));
    const future = Object.fromEntries(Object.keys(versions).map(key => [key, '99.0.0']));
    for (const [expected, value, chinese, command] of [
      ['standard.freshness.current', {sourceHash: COMPONENT_STANDARD_SOURCE_HASH}, /本地创作标准/, null],
      ['standard.freshness.local_below_floor', {sourceHash: COMPONENT_STANDARD_SOURCE_HASH, authoringStandardRelease: {minPackageVersions: future}}, /低于.*最低版本/, 'promptframe sync . --apply'],
      ['standard.freshness.platform_behind', {sourceHash: `sha256:${'8'.repeat(64)}`, authoringStandardRelease: {minPackageVersions: old}}, /平台版本落后/, 'promptframe upgrade . --apply'],
      ['standard.freshness.upload_blocking', {sourceHash: `sha256:${'9'.repeat(64)}`}, /标准已过时/, 'promptframe sync . --apply'],
      ['standard.freshness.recommended_update', {sourceHash: COMPONENT_STANDARD_SOURCE_HASH, recommendedAuthoringPackages: future}, /可选的兼容更新/, 'promptframe sync . --apply'],
    ]) {
      payload = value;
      const run = async lang => {
        try {
          return {exit: 0, row: JSON.parse((await exec(process.execPath, [cli, 'check', component, '--endpoint', endpoint, '--json'],
            {env: environment(dir, {PROMPTFRAME_LANG: lang})})).stdout)};
        } catch (error) {return {exit: error.code, row: JSON.parse(error.stderr)};}
      };
      const en = await run('en'), zh = await run('zh');
      assert.equal(en.exit, zh.exit);
      const ed = en.row.diagnostic.code === expected ? en.row.diagnostic : en.row.freshness.diagnostic;
      const zd = zh.row.diagnostic.code === expected ? zh.row.diagnostic : zh.row.freshness.diagnostic;
      assert.equal(ed.code, expected); assert.equal(zd.code, expected); assert.match(zd.message, chinese);
      if (command) {assert.ok(ed.message.includes(command)); assert.ok(zd.message.includes(command));}
      if (expected === 'standard.freshness.local_below_floor' || expected === 'standard.freshness.upload_blocking') {
        const install = ed.message.match(/Run (pnpm add .*?) and then /)?.[1];
        assert.ok(install); assert.ok(zd.message.includes(install));
      }
      if (expected === 'standard.freshness.platform_behind') assert.match(zd.message, /无法解决/);
    }
    assert.ok(calls.every(([method, url]) => method === 'GET' && url === '/components/standard'));
  } finally {await new Promise(resolve => server.close(resolve)); await rm(dir, {recursive: true, force: true});}
});
