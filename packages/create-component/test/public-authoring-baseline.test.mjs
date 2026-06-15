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
    assert.equal(packageJson.dependencies?.['@promptframe/component-kit'], '^0.1.11', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@promptframe/contracts'], '^0.1.13', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@remotion/player'], '^4.0.0', templatePackagePath);
    assert.equal(packageJson.devDependencies?.['@promptframe/cli'], '^0.1.31', templatePackagePath);
  }
});

test('create package version is bumped for the next template release', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'packages/create-component/package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.1.18');
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

test('public authoring docs and templates expose component public resource contract', async () => {
  for (const docPath of [
    'README.md',
    'packages/cli/README.md',
    'packages/component-kit/README.md',
    'packages/contracts/README.md',
    'skills/component-authoring/SKILL.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /publicResources|public\/|promptFramePublicResource/, docPath);
    assert.doesNotMatch(text, /does not currently expose a component-level `public\/` hosting contract/, docPath);
  }

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const component = await readFile(path.join(repoRoot, templateRoot, 'src/Component.tsx'), 'utf8');
    const sample = JSON.parse(await readFile(path.join(repoRoot, templateRoot, 'public/sample-data.json'), 'utf8'));
    assert.match(component, /promptFramePublicResource/, templateRoot);
    assert.equal(sample.label, 'PromptFrame public resource sample');
  }
});

test('public authoring docs document the current npm registry baseline', async () => {
  for (const docPath of [
    'README.md',
    'packages/cli/README.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /Current npm registry baseline is[\s\S]*@promptframe\/cli@0\.1\.31[\s\S]*create-promptframe-component@0\.1\.18/, docPath);
    assert.doesNotMatch(text, /source candidate|source tree prepares|until Trusted Publishing completes/, docPath);
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

test('public skill documents external CLI login and CI automation workflow', async () => {
  const skill = await readFile(path.join(repoRoot, 'skills/component-authoring/SKILL.md'), 'utf8');

  for (const marker of [
    'promptframe login --endpoint <promptframe-api-base>',
    'promptframe setup-ci --provider github',
    'PROMPTFRAME_CI_TOKEN',
    'PROMPTFRAME_API_BASE',
    'GitHub Check annotations',
    'Action summary',
    'artifact report',
    'platform status',
    'Do not read remotion-media internal REQ/TASK/QA',
    'third-party components are not browser extensions',
  ]) {
    assert.match(skill, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
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

test('public templates keep the PreviewRoot viewport locked and Player contained', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /height:\s*'100vh'/, templateRoot);
    assert.match(previewRoot, /overflow:\s*'hidden'/, templateRoot);
    assert.match(previewRoot, /maxHeight:\s*'100%'/, templateRoot);
    assert.match(previewRoot, /acknowledgeRemotionLicense/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-stage/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-player/, templateRoot);
  }
});

test('public templates provide JSON fallback controls for complex props', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /isJsonLikeValue/, templateRoot);
    assert.match(previewRoot, /data-promptframe-prop-json/, templateRoot);
    assert.match(previewRoot, /JSON\.parse/, templateRoot);
    assert.doesNotMatch(previewRoot, /String\(value\)/, templateRoot);
  }
});

test('public docs document npx quickstart, pnpm workspace install and Remotion license context', async () => {
  for (const docPath of [
    'README.md',
    'skills/component-authoring/SKILL.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');

    assert.match(text, /npx -y create-promptframe-component@latest/, docPath);
    assert.match(text, /pnpm install --ignore-workspace/, docPath);
    assert.match(text, /Remotion license|Remotion 许可证/, docPath);
  }
});

test('public authoring docs document fps-aware timing and the AST rule boundary', async () => {
  const timingRule = await readFile(path.join(repoRoot, 'skills/component-authoring/rules/timing-ssot.md'), 'utf8');
  const skill = await readFile(path.join(repoRoot, 'skills/component-authoring/SKILL.md'), 'utf8');
  const componentKitReadme = await readFile(path.join(repoRoot, 'packages/component-kit/README.md'), 'utf8');

  for (const text of [timingRule, skill, componentKitReadme]) {
    assert.match(text, /secondsToFrames/, text.slice(0, 80));
    assert.match(text, /fps-aware|fps 自适应|fps-aware timing/i, text.slice(0, 80));
    assert.match(text, /30fps[\s\S]*60fps|60fps[\s\S]*30fps/, text.slice(0, 80));
  }

  assert.match(timingRule, /runtime\.deterministic\.fps_hardcoded_timing/);
  assert.match(timingRule, /warning.*diagnostics|diagnostics.*warning/i);
  assert.match(timingRule, /interpolate\(frame, \[30, 60\]/);
  assert.match(timingRule, /spring\(\{[\s\S]*fps: 30/);
  assert.match(timingRule, /timeline\.at\(|secondsToFrames\(/);
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
