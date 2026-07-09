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
    assert.equal(packageJson.dependencies?.['@promptframe/component-kit'], '^0.1.17', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@promptframe/contracts'], '^0.1.21', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@remotion/player'], '^4.0.0', templatePackagePath);
    assert.equal(packageJson.devDependencies?.['@vitejs/plugin-react'], '^6.0.1', templatePackagePath);
    assert.equal(packageJson.devDependencies?.['@promptframe/cli'], '^0.1.53', templatePackagePath);
    assert.equal(packageJson.devDependencies?.typescript, '~6.0.2', templatePackagePath);
    assert.equal(packageJson.devDependencies?.vite, '^8.0.10', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@vitejs/plugin-react'], undefined, templatePackagePath);
    assert.equal(packageJson.dependencies?.typescript, undefined, templatePackagePath);
    assert.equal(packageJson.dependencies?.vite, undefined, templatePackagePath);
  }
});

test('create package version is bumped for the next template release', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'packages/create-component/package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.1.43');
});

test('public authoring docs include a single AUTHORING recovery entrypoint', async () => {
  for (const docPath of [
    'AUTHORING.md',
    'templates/react-remotion/AUTHORING.md',
    'packages/create-component/templates/react-remotion/AUTHORING.md',
  ]) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /promptframe sync \. --apply/, docPath);
    assert.match(text, /PromptFramePreviewApp/, docPath);
    assert.match(text, /resource slot|资源槽/i, docPath);
    assert.match(text, /locale|语言/i, docPath);
    assert.match(text, /reset|重置/i, docPath);
    assert.match(text, /freshness|标准新鲜度|版本新鲜度/i, docPath);
  }
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

test('public templates wire local public resource picker through component-kit inspector', async () => {
  const sharedPreviewShell = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewShell, /renderPreviewAppResourcePicker/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-resource-picker/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-resource-select/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /promptFrameRuntimeResourceMatchesSlot/, 'component-kit shared preview shell');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');
    const generatedResources = await readFile(path.join(repoRoot, templateRoot, 'src/promptframe-dev-public-resources.generated.ts'), 'utf8');

    assert.match(previewRoot, /promptFrameDevPublicResources/, templateRoot);
    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.doesNotMatch(previewRoot, /renderResourcePicker/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-preview-resource-picker/, templateRoot);
    assert.match(generatedResources, /ComponentPublicResourceKind/, templateRoot);
    assert.match(generatedResources, /promptFrameDevPublicResources/, templateRoot);
    assert.match(generatedResources, /readonly PromptFrameDevPublicResource\[\] = \[\]/, templateRoot);
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
    assert.match(text, /@promptframe\/contracts@0\.1\.21/, docPath);
    assert.match(text, /@promptframe\/component-kit@0\.1\.17/, docPath);
    assert.match(text, /@promptframe\/cli@0\.1\.53/, docPath);
    assert.match(text, /create-promptframe-component@0\.1\.43/, docPath);
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
  const sharedPreviewShell = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewShell, /buildPromptFramePreviewControlsFromSchema/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /previewAspectPresets/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /16:9/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /9:16/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /1:1/, 'component-kit shared preview shell');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.doesNotMatch(previewRoot, /useState/, templateRoot);
    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.match(previewRoot, /propsSchema\.safeParse/, templateRoot);
    assert.doesNotMatch(previewRoot, /previewAspectPresets/, templateRoot);
    assert.doesNotMatch(previewRoot, /previewInspectorControls/, templateRoot);
    assert.doesNotMatch(previewRoot, /PromptFramePreviewControl/, templateRoot);
    assert.doesNotMatch(previewRoot, /setInputProps/, templateRoot);
  }
});

test('public templates expose saved local preview case export controls', async () => {
  for (const docPath of ['README.md', 'skills/component-authoring/SKILL.md']) {
    const text = await readFile(path.join(repoRoot, docPath), 'utf8');
    assert.match(text, /\.promptframe\/local-previews/, docPath);
  }

  const sharedPreviewShell = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewShell, /exportPreviewCase/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-case-export/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /generatedAt/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /durationFrames/, 'component-kit shared preview shell');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');
    const readme = await readFile(path.join(repoRoot, templateRoot, 'README.md'), 'utf8');

    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.doesNotMatch(previewRoot, /buildPreviewCase/, templateRoot);
    assert.doesNotMatch(previewRoot, /exportPreviewCase/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-preview-case-export/, templateRoot);
    assert.match(previewRoot, /durationFrames/, templateRoot);
    assert.doesNotMatch(previewRoot, /const \[inputProps/, templateRoot);
    assert.match(readme, /\.promptframe\/local-previews/, templateRoot);
    assert.match(readme, /导出|保存/, templateRoot);
  }
});

test('public templates expose the component-kit preview case matrix without default aspect/fps diagnostics', async () => {
  const sharedPreviewShell = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewShell, /createPreviewCaseMatrix/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-case-apply/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-baseline-reset/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-aspect-case/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-case-kind/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /aspectPresets:\s*\[\]/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /durationScalePresets:\s*\[0\.5,\s*2\]/, 'component-kit shared preview shell');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');
    const readme = await readFile(path.join(repoRoot, templateRoot, 'README.md'), 'utf8');

    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.doesNotMatch(previewRoot, /createPreviewCaseMatrix/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-preview-case-apply/, templateRoot);
    assert.doesNotMatch(previewRoot, /data-promptframe-preview-baseline-reset/, templateRoot);
    assert.doesNotMatch(previewRoot, /fpsPresets/, templateRoot);
    assert.doesNotMatch(previewRoot, /caseKind === 'fps_diagnostic'/, templateRoot);
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
    assert.doesNotMatch(previewRoot, /navigator\.language\b/, templateRoot);
  }
});

test('public templates localize PreviewRoot controls and derive readable prop labels', async () => {
  const sharedPreviewShell = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewShell, /previewAppMessages/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /formatPromptFramePreviewPropLabel/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /buildPromptFramePreviewControlsFromSchema/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /PromptFramePreviewInspector/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /Aspect/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /画幅/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /Props/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /属性/, 'component-kit shared preview shell');

  for (const templateRoot of [
    'templates/react-remotion',
    'packages/create-component/templates/react-remotion',
  ]) {
    const previewRoot = await readFile(path.join(repoRoot, templateRoot, 'src/PreviewRoot.tsx'), 'utf8');

    assert.match(previewRoot, /resolvePromptFramePreviewLocale/, templateRoot);
    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.doesNotMatch(previewRoot, /previewMessages/, templateRoot);
    assert.doesNotMatch(previewRoot, /formatPromptFramePreviewPropLabel/, templateRoot);
    assert.doesNotMatch(previewRoot, /buildPromptFramePreviewControlsFromSchema/, templateRoot);
    assert.doesNotMatch(previewRoot, /PromptFramePreviewInspector/, templateRoot);
    assert.match(previewRoot, /@promptframe\/component-kit\/preview-react/, templateRoot);
    assert.doesNotMatch(previewRoot, /navigator\.clipboard/, templateRoot);
    assert.doesNotMatch(previewRoot, /function formatPropLabel/, templateRoot);
    assert.doesNotMatch(previewRoot, /function coerceControlValue/, templateRoot);
    assert.doesNotMatch(previewRoot, /function inferSchemaFromPreviewValue/, templateRoot);
    assert.doesNotMatch(previewRoot, /inferSchemaFromPreviewValue\(/, templateRoot);
    assert.doesNotMatch(previewRoot, /function renderPropControl|const renderPropControl/, templateRoot);
    assert.doesNotMatch(previewRoot, /renderPropControl\(/, templateRoot);
    assert.doesNotMatch(previewRoot, /describePromptFramePreviewPropControl/, templateRoot);
  }
});

test('public templates keep the PreviewRoot viewport locked and Player contained with gold shell layout', async () => {
  const sharedPreviewShell = await readFile(path.join(repoRoot, 'packages/component-kit/src/preview-react.ts'), 'utf8');
  assert.match(sharedPreviewShell, /height:\s*'100%'/, 'component-kit shared preview shell');
  assert.doesNotMatch(sharedPreviewShell, /height:\s*'100vh'|width:\s*'100vw'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /overflow:\s*'hidden'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /fillPlayerByWidth/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /width:\s*fillByWidth\s*\?\s*'100%'\s*:\s*'auto'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /height:\s*fillByWidth\s*\?\s*'auto'\s*:\s*'100%'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /maxWidth:\s*'100%'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /maxHeight:\s*'100%'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /position:\s*'sticky'/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-stage/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-player/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-controls-scroll/, 'component-kit shared preview shell');
  assert.match(sharedPreviewShell, /data-promptframe-preview-aspect-toolbar/, 'component-kit shared preview shell');

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
    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.match(previewRoot, /renderStage/, templateRoot);
    assert.doesNotMatch(previewRoot, /1280px|min\(100%,\s*1280px/, templateRoot);
    assert.match(previewRoot, /acknowledgeRemotionLicense/, templateRoot);
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

    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
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

    assert.match(previewRoot, /PromptFramePreviewApp/, templateRoot);
    assert.doesNotMatch(previewRoot, /previewInspectorControls/, templateRoot);
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
  assert.match(timingRule, /manual_review|validation gate|阻断/);
  assert.match(timingRule, /interpolate\(frame, \[30, 60\]/);
  assert.match(timingRule, /spring\(\{[\s\S]*fps: 30/);
  assert.match(timingRule, /timeline\.at\(|secondsToFrames\(|createRevealPhases\(|createFillProgress\(/);
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
