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
    assert.equal(packageJson.dependencies?.['@promptframe/component-kit'], '^0.1.13', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@promptframe/contracts'], '^0.1.17', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@remotion/player'], '^4.0.0', templatePackagePath);
    assert.equal(packageJson.devDependencies?.['@vitejs/plugin-react'], '^6.0.1', templatePackagePath);
    assert.equal(packageJson.devDependencies?.['@promptframe/cli'], '^0.1.45', templatePackagePath);
    assert.equal(packageJson.devDependencies?.typescript, '~6.0.2', templatePackagePath);
    assert.equal(packageJson.devDependencies?.vite, '^8.0.10', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@vitejs/plugin-react'], undefined, templatePackagePath);
    assert.equal(packageJson.dependencies?.typescript, undefined, templatePackagePath);
    assert.equal(packageJson.dependencies?.vite, undefined, templatePackagePath);
  }
});

test('create package version is bumped for the next template release', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'packages/create-component/package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.1.37');
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
    assert.match(workflow, /# promptframe-workflow-version: 2/, workflowPath);
    assert.match(workflow, /pull_request:/, workflowPath);
    assert.match(workflow, /branches: \[main\]/, workflowPath);
    assert.match(workflow, /\$\{\{ secrets\.PROMPTFRAME_CI_TOKEN \}\}/, workflowPath);
    assert.match(workflow, /\$\{\{ vars\.PROMPTFRAME_API_BASE \}\}/, workflowPath);
    assert.match(workflow, /promptframe check \. --json/, workflowPath);
    assert.match(workflow, /PROMPTFRAME_VERSION_NOTES=/, workflowPath);
    assert.match(workflow, /promptframe upload \. --endpoint "\$PROMPTFRAME_API_BASE" --release-notes "\$PROMPTFRAME_VERSION_NOTES" --json/, workflowPath);
    assert.match(workflow, /Version notes:/, workflowPath);
    assert.match(workflow, /promptframe status "\$BUILD_ID" --endpoint "\$PROMPTFRAME_API_BASE" --json --fail-on-build-failed/, workflowPath);
    assert.match(workflow, /::error title=PromptFrame platform build failed::/, workflowPath);
    assert.match(workflow, /exit "\$STATUS_EXIT"/, workflowPath);
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
    assert.match(component, /PromptFrameRuntimeResourceProps/, templateRoot);
    assert.match(component, /ComponentProps\s*&\s*PromptFrameRuntimeResourceProps/, templateRoot);
    assert.equal(sample.label, 'PromptFrame public resource sample');
  }
});

test('public authoring docs document the current source baseline', async () => {
  for (const docPath of [
    'README.md',
    'packages/cli/README.md',
    'templates/react-remotion/README.md',
    'packages/create-component/templates/react-remotion/README.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /Current source baseline is/, docPath);
    assert.match(text, /@promptframe\/contracts@0\.1\.17/, docPath);
    assert.match(text, /@promptframe\/component-kit@0\.1\.13/, docPath);
    assert.match(text, /@promptframe\/cli@0\.1\.45/, docPath);
    assert.match(text, /create-promptframe-component@0\.1\.37/, docPath);
    assert.match(text, /workspace root lockfile|workspace root lockfile evidence|pnpm workspace root lockfile/, docPath);
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
    assert.match(previewRoot, /previewInspectorControls/, templateRoot);
    assert.match(previewRoot, /PromptFramePreviewControl/, templateRoot);
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

test('public templates expose the component-kit preview case matrix without default aspect/fps diagnostics', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');
    const readme = await readFile(path.join(repoRoot, templateRoot, 'README.md'), 'utf8');

    assert.match(previewRoot, /createPreviewCaseMatrix/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-case-apply/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-baseline-reset/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-aspect-case/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-case-kind/, templateRoot);
    assert.match(previewRoot, /aspectPresets:\s*\[\]/, templateRoot);
    assert.match(previewRoot, /fpsPresets:\s*\[\]/, templateRoot);
    assert.match(previewRoot, /caseKind === 'props_stress'/, templateRoot);
    assert.doesNotMatch(previewRoot, /caseKind === 'fps_diagnostic'/, templateRoot);
    assert.match(previewRoot, /Auto cases/, templateRoot);
    assert.match(previewRoot, /Platform probe equivalent/, templateRoot);
    assert.match(previewRoot, /Local diagnostic only/, templateRoot);
    assert.match(previewRoot, /propsSchema\.safeParse/, templateRoot);
    assert.match(readme, /自动生成.*preview cases|preview cases.*自动生成/, templateRoot);
  }
});

test('public templates use CSS Module and slot layout helper instead of all-inline root styles', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const component = await readFile(path.join(repoRoot, templateRoot, 'src/Component.tsx'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(repoRoot, templateRoot, 'manifest.json'), 'utf8'));
    const cssModule = await readFile(path.join(repoRoot, templateRoot, 'src/Component.module.css'), 'utf8');
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(component, /@promptframe\/component-kit\/layout/, templateRoot);
    assert.match(component, /createPromptFrameLayout/, templateRoot);
    assert.match(component, /from '\.\/Component\.module\.css'/, templateRoot);
    assert.match(component, /styles\.root/, templateRoot);
    assert.match(component, /layout\.px\(/, templateRoot);
    assert.doesNotMatch(component, /padding:\s*72\b/, templateRoot);
    assert.doesNotMatch(component, /fontSize:\s*68\b/, templateRoot);
    assert.match(cssModule, /\.root/, templateRoot);
    assert.equal(manifest.layout?.contractVersion, 'layout-capability.v0.1.0', templateRoot);
    assert.equal(manifest.layout?.layoutMode, 'slot_fill_reflow', templateRoot);
    assert.equal(manifest.layout?.recommendedSlot, 'full_screen', templateRoot);
    assert.deepEqual(manifest.layout?.supportedAspectRatios, ['16:9', '9:16', '1:1'], templateRoot);
    assert.doesNotMatch(previewRoot, /navigator\.language/, templateRoot);
  }
});

test('public templates localize PreviewRoot controls and derive readable prop labels', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /type PreviewLocale = 'en' \| 'zh'/, templateRoot);
    assert.match(previewRoot, /previewMessages/, templateRoot);
    assert.match(previewRoot, /resolvePreviewLocale/, templateRoot);
    assert.match(previewRoot, /formatPromptFramePreviewPropLabel/, templateRoot);
    assert.match(previewRoot, /PromptFramePreviewInspector/, templateRoot);
    assert.match(previewRoot, /@promptframe\/component-kit\/preview-react/, templateRoot);
    assert.match(previewRoot, /isZh/, templateRoot);
    assert.match(previewRoot, /Aspect/, templateRoot);
    assert.match(previewRoot, /画幅/, templateRoot);
    assert.match(previewRoot, /Props/, templateRoot);
    assert.match(previewRoot, /属性/, templateRoot);
    assert.match(previewRoot, /<PromptFramePreviewInspector/, templateRoot);
    assert.match(previewRoot, /onPreviewPropsChange=\{updateInputProps\}/, templateRoot);
    assert.match(previewRoot, /scrollMode="parent"/, templateRoot);
    assert.doesNotMatch(previewRoot, /navigator\.clipboard/, templateRoot);
    assert.doesNotMatch(previewRoot, /function formatPropLabel/, templateRoot);
    assert.doesNotMatch(previewRoot, /function coerceControlValue/, templateRoot);
    assert.doesNotMatch(previewRoot, /function renderPropControl|const renderPropControl/, templateRoot);
    assert.doesNotMatch(previewRoot, /renderPropControl\(/, templateRoot);
    assert.doesNotMatch(previewRoot, /describePromptFramePreviewPropControl/, templateRoot);
  }
});

test('public templates keep the PreviewRoot viewport locked and Player contained with gold shell layout', async () => {
  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const indexHtml = await readFile(path.join(repoRoot, templateRoot, 'index.html'), 'utf8');
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(indexHtml, /html,\s*body/, templateRoot);
    assert.match(indexHtml, /#root/, templateRoot);
    assert.match(indexHtml, /height:\s*100%/, templateRoot);
    assert.match(indexHtml, /margin:\s*0/, templateRoot);
    assert.match(previewRoot, /height:\s*'100%'/, templateRoot);
    assert.doesNotMatch(previewRoot, /height:\s*'100vh'|width:\s*'100vw'/, templateRoot);
    assert.match(previewRoot, /overflow:\s*'hidden'/, templateRoot);
    assert.match(previewRoot, /fillPlayerByWidth/, templateRoot);
    assert.match(previewRoot, /width:\s*fillPlayerByWidth\s*\?\s*'100%'\s*:\s*'auto'/, templateRoot);
    assert.match(previewRoot, /height:\s*fillPlayerByWidth\s*\?\s*'auto'\s*:\s*'100%'/, templateRoot);
    assert.match(previewRoot, /maxWidth:\s*'100%'/, templateRoot);
    assert.match(previewRoot, /maxHeight:\s*'100%'/, templateRoot);
    assert.match(previewRoot, /aspectPresets:\s*\[\]/, templateRoot);
    assert.match(previewRoot, /fpsPresets:\s*\[\]/, templateRoot);
    assert.match(previewRoot, /position:\s*'sticky'/, templateRoot);
    assert.doesNotMatch(previewRoot, /1280px|min\(100%,\s*1280px/, templateRoot);
    assert.match(previewRoot, /PromptFramePreviewInspector/, templateRoot);
    assert.match(previewRoot, /acknowledgeRemotionLicense/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-stage/, templateRoot);
    assert.match(previewRoot, /data-promptframe-preview-player/, templateRoot);
  }
});

test('public templates provide JSON fallback controls for complex props', async () => {
  const sharedPreviewInspector = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewInspector, /data-preview-props-json-control/, 'component-kit shared preview inspector');
  assert.match(sharedPreviewInspector, /data-preview-props-json-error/, 'component-kit shared preview inspector');
  assert.match(sharedPreviewInspector, /parsePromptFramePreviewInspectorJsonDraft/, 'component-kit shared preview inspector');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /PromptFramePreviewInspector/, templateRoot);
    assert.match(previewRoot, /@promptframe\/component-kit\/preview-react/, templateRoot);
    assert.doesNotMatch(previewRoot, /isPromptFramePreviewJsonLikeValue/, templateRoot);
    assert.doesNotMatch(previewRoot, /parsePromptFramePreviewJsonDraft/, templateRoot);
    assert.doesNotMatch(previewRoot, /jsonDraftErrors/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-prop-json/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-json-draft-error/, templateRoot);
    assert.doesNotMatch(previewRoot, /function parseJsonDraft/, templateRoot);
    assert.doesNotMatch(previewRoot, /String\(value\)/, templateRoot);
  }
});

test('public templates render complex props as structured controls before JSON fallback', async () => {
  const sharedPreviewInspector = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewInspector, /data-preview-props-structured-control/, 'component-kit shared preview inspector');
  assert.match(sharedPreviewInspector, /data-preview-props-field/, 'component-kit shared preview inspector');
  assert.match(sharedPreviewInspector, /data-preview-props-array-item/, 'component-kit shared preview inspector');
  assert.match(sharedPreviewInspector, /Advanced JSON/, 'component-kit shared preview inspector');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /PromptFramePreviewInspector/, templateRoot);
    assert.match(previewRoot, /previewInspectorControls/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-prop-structured/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-prop-field/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-prop-array-item/, templateRoot);
    assert.doesNotMatch(previewRoot, /getValueAtPath/, templateRoot);
    assert.doesNotMatch(previewRoot, /setValueAtPath/, templateRoot);
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
