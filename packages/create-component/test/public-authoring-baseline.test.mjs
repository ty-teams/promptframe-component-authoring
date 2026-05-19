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
    assert.equal(packageJson.dependencies?.['@promptframe/component-kit'], '^0.1.6', templatePackagePath);
    assert.equal(packageJson.dependencies?.['@promptframe/contracts'], '^0.1.4', templatePackagePath);
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
