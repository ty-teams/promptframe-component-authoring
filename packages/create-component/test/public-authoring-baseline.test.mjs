import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

test('public templates use the current PromptFrame authoring package baseline', async () => {
  for (const templatePackagePath of [
    'templates/react-remotion/package.json',
    'packages/create-component/templates/react-remotion/package.json',
  ]) {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, templatePackagePath), 'utf8'));
    assert.equal(packageJson.dependencies?.['@promptframe/component-kit'], '^0.1.7', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@promptframe/contracts'], '^0.1.8', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@remotion/player'], '^4.0.0', templatePackagePath);
    assert.equal(packageJson.devDependencies?.['@promptframe/cli'], '^0.1.21', templatePackagePath);
  }
});

test('create package version is bumped for the next template release', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'packages/create-component/package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.1.12');
});

test('public templates expose PromptFrame CLI lifecycle scripts', async () => {
  for (const templatePackagePath of [
    'templates/react-remotion/package.json',
    'packages/create-component/templates/react-remotion/package.json',
  ]) {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, templatePackagePath), 'utf8'));
    assert.equal(packageJson.scripts?.dev, 'promptframe dev .', templatePackagePath);
    assert.equal(packageJson.scripts?.['preview:serve'], 'vite --host 127.0.0.1', templatePackagePath);
    assert.equal(packageJson.scripts?.check, 'promptframe check .', templatePackagePath);
    assert.equal(packageJson.scripts?.upload, 'promptframe upload .', templatePackagePath);
    assert.equal(packageJson.scripts?.upgrade, 'promptframe upgrade .', templatePackagePath);
  }
});

test('public templates include GitHub CI workflow skeleton without private endpoint defaults', async () => {
  for (const workflowPath of [
    'templates/react-remotion/.github/workflows/promptframe-component.yml',
    'packages/create-component/templates/react-remotion/.github/workflows/promptframe-component.yml',
  ]) {
    const workflow = await readFile(path.join(repoRoot, workflowPath), 'utf8');
    assert.match(workflow, /pull_request:/, workflowPath);
    assert.match(workflow, /branches: \[main\]/, workflowPath);
    assert.match(workflow, /\$\{\{ secrets\.PROMPTFRAME_CI_TOKEN \}\}/, workflowPath);
    assert.match(workflow, /\$\{\{ vars\.PROMPTFRAME_API_BASE \}\}/, workflowPath);
    assert.match(workflow, /promptframe check \. --json/, workflowPath);
    assert.match(workflow, /promptframe upload \. --endpoint "\$PROMPTFRAME_API_BASE" --json/, workflowPath);
    assert.match(workflow, /promptframe status "\$BUILD_ID" --endpoint "\$PROMPTFRAME_API_BASE" --json/, workflowPath);
    assert.doesNotMatch(workflow, /pf_(?:ci|human|cli)_[A-Za-z0-9_-]+/, workflowPath);
    assert.doesNotMatch(workflow, /promptframe-beta|tail0fae3a|100\.\d+\.\d+\.\d+/, workflowPath);
  }
});

test('public authoring docs use buildId for platform build status commands', async () => {
  for (const docPath of [
    'skills/component-authoring/SKILL.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.doesNotMatch(text, /<jobId>/, docPath);
    assert.match(text, /<buildId>/, docPath);
  }
});

test('public authoring docs include the local preview command before upload', async () => {
  for (const docPath of [
    'README.md',
    'packages/cli/README.md',
    'skills/component-authoring/SKILL.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /promptframe dev \./, docPath);
    assert.match(text, /promptframe preview \./, docPath);
  }
});

test('public skill documents common diagnostics and security rule fixes', async () => {
  const skill = await readFile(path.join(repoRoot, 'skills/component-authoring/SKILL.md'), 'utf8');
  assert.match(skill, /Common Diagnostics/);
  for (const code of [
    'doctor.required_files.missing',
    'component_standard.source.no_math_random',
    'code.eval',
    'network.raw_fetch',
    'prompt.injection_string',
    'network.remote_url',
  ]) {
    assert.match(skill, new RegExp(code.replaceAll('.', '\\.')));
  }
});

test('public templates include a real Remotion Player dev preview shell', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const indexHtml = await readFile(path.join(repoRoot, templateRoot, 'index.html'), 'utf8');
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(indexHtml, /src\/PreviewRoot\.tsx/, templateRoot);
    assert.match(previewRoot, /@remotion\/player/, templateRoot);
    assert.match(previewRoot, /preview-props\.json/, templateRoot);
    assert.match(previewRoot, /propsSchema\.parse/, templateRoot);
  }
});

test('public templates expose schema-derived local controls and aspect presets', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /useState/, templateRoot);
    assert.match(previewRoot, /propsSchema\.safeParse/, templateRoot);
    assert.match(previewRoot, /previewAspectPresets/, templateRoot);
    assert.match(previewRoot, /16:9/, templateRoot);
    assert.match(previewRoot, /9:16/, templateRoot);
    assert.match(previewRoot, /1:1/, templateRoot);
    assert.match(previewRoot, /Object\.entries\(inputProps\)/, templateRoot);
    assert.match(previewRoot, /setInputProps/, templateRoot);
  }
});

test('public templates expose saved local preview case export controls', async () => {
  for (const docPath of ['README.md', 'skills/component-authoring/SKILL.md']) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /\.promptframe\/local-previews/, docPath);
  }

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');
    const readme = await readFile(path.join(repoRoot, templateRoot, 'README.md'), 'utf8');

    assert.match(previewRoot, /buildPreviewCase/, templateRoot);
    assert.match(previewRoot, /exportPreviewCase/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-case-export/, templateRoot);
    assert.match(previewRoot, /generatedAt/, templateRoot);
    assert.match(previewRoot, /durationFrames/, templateRoot);
    assert.match(previewRoot, /inputProps/, templateRoot);
    assert.match(readme, /\.promptframe\/local-previews/, templateRoot);
    assert.match(readme, /导出|保存/, templateRoot);
  }
});

test('public templates expose component-kit generated preview case matrix', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');
    const readme = await readFile(path.join(repoRoot, templateRoot, 'README.md'), 'utf8');

    assert.match(previewRoot, /createPreviewCaseMatrix/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-case-apply/, templateRoot);
    assert.match(previewRoot, /Auto cases/, templateRoot);
    assert.match(previewRoot, /propsSchema\.safeParse/, templateRoot);
    assert.match(readme, /自动生成.*preview cases|preview cases.*自动生成/, templateRoot);
  }
});

test('public authoring docs describe the AI-first authoring boundary', async () => {
  for (const docPath of [
    'skills/component-authoring/SKILL.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /CodingAI/, docPath);
    assert.match(text, /marketplace_authoring/, docPath);
    assert.match(text, /project_private_generation/, docPath);
    assert.match(text, /@promptframe\/component-kit\/style/, docPath);
    assert.match(text, /color.*theme.*style|style.*theme.*color/s, docPath);
  }
});
