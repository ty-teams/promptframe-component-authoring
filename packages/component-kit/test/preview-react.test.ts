import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createPromptFramePreviewInitialState,
  PromptFramePreviewApp,
  PromptFramePreviewInspector,
  promptFramePreviewControlResourceSlot,
  resetPromptFramePreviewState,
  resolvePromptFramePreviewLocale,
  buildPromptFramePreviewControlsFromSchema,
  parsePromptFramePreviewInspectorJsonDraft,
  type PromptFramePreviewControl,
} from '../src/preview-react.js';

test('PromptFramePreviewInspector renders shared selectors for nested props and read-only state', () => {
  const controls: PromptFramePreviewControl[] = [
    {
      key: 'title',
      type: 'text',
      label: 'Title',
      description: 'Main title',
      defaultValue: 'Launch',
    },
    {
      key: 'variant',
      type: 'enum',
      label: 'Variant',
      enumValues: ['compact', 'hero'],
      defaultValue: 'compact',
    },
    {
      key: 'accent',
      type: 'color',
      label: 'Accent',
      defaultValue: '#38bdf8',
    },
    {
      key: 'items',
      type: 'array',
      label: 'Items',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Item label' },
            count: { type: 'number', minimum: 0, maximum: 10 },
          },
        },
      },
      defaultValue: [{ label: 'A', count: 1 }],
    },
  ];

  const element = React.createElement(PromptFramePreviewInspector, {
    controls,
    previewProps: {
      title: 'Launch',
      variant: 'hero',
      accent: '#38bdf8',
      items: [{ label: 'A', count: 1 }],
    },
    editable: false,
    locale: 'en',
  });

  const markup = renderToStaticMarkup(element);
  assert.match(markup, /data-preview-props-inspector/);
  assert.match(markup, /data-preview-props-field/);
  assert.match(markup, /data-preview-props-structured-control/);
  assert.match(markup, /data-preview-props-array-item/);
  assert.match(markup, /aria-readonly/);
  assert.match(markup, /Advanced JSON/);
  assert.equal(React.isValidElement(element), true);
});

test('PromptFramePreviewInspector preserves explicit null preview prop values', () => {
  const element = React.createElement(PromptFramePreviewInspector, {
    controls: [{
      key: 'nullable',
      type: 'object',
      label: 'Nullable',
      defaultValue: { fallback: true },
    }],
    previewProps: { nullable: null },
    editable: false,
    locale: 'en',
  });

  const markup = renderToStaticMarkup(element);
  assert.match(markup, /&quot;nullable&quot;: null/);
  assert.match(markup, />null<\/textarea>/);
  assert.doesNotMatch(markup, /fallback/);
});

test('preview state reset restores props, size, timing, case name and locale as one snapshot', () => {
  const initialState = createPromptFramePreviewInitialState({
    props: { title: 'Launch', asset: '/logo.png' },
    width: 1280,
    height: 720,
    fps: 30,
    durationFrames: 120,
    caseName: 'baseline',
    locale: 'zh',
  });

  const dirtyState = {
    ...initialState,
    props: { title: 'Changed', asset: '/changed.png' },
    size: { label: '9:16', width: 720, height: 1280 },
    timing: { label: 'slow', fps: 30 as const, durationFrames: 240 },
    caseName: 'mutated',
    locale: 'en' as const,
  };

  assert.notDeepEqual(dirtyState, initialState);
  assert.deepEqual(resetPromptFramePreviewState(initialState), initialState);
  assert.deepEqual(resetPromptFramePreviewState(initialState, dirtyState), initialState);
  assert.notEqual(resetPromptFramePreviewState(initialState), initialState);
});

test('resolvePromptFramePreviewLocale uses explicit, URL, env and browser-language sources before English fallback', () => {
  assert.equal(resolvePromptFramePreviewLocale({ explicitLocale: 'zh' }), 'zh');
  assert.equal(resolvePromptFramePreviewLocale({ search: '?locale=zh-CN' }), 'zh');
  assert.equal(resolvePromptFramePreviewLocale({ envLocale: 'zh_CN.UTF-8' }), 'zh');
  assert.equal(resolvePromptFramePreviewLocale({ navigatorLanguages: ['fr-FR', 'zh-Hans'] }), 'zh');
  assert.equal(resolvePromptFramePreviewLocale({ explicitLocale: 'en' }), 'en');
  assert.equal(resolvePromptFramePreviewLocale({ search: '?locale=fr' }), 'en');
});

test('PromptFramePreviewInspector only renders resource pickers for explicit resource slots', () => {
  const calls: string[] = [];
  const controls: PromptFramePreviewControl[] = [
    {
      key: 'title',
      type: 'text',
      label: 'Title',
      defaultValue: 'Launch',
      schema: { type: 'string' },
    },
    {
      key: 'backgroundImage',
      type: 'text',
      label: 'Background image',
      defaultValue: '/hero.png',
      schema: {
        type: 'string',
        promptFrameResource: { accept: ['image/*'] },
      },
    },
  ];

  const element = React.createElement(PromptFramePreviewInspector, {
    controls,
    previewProps: {
      title: 'Launch',
      backgroundImage: '/hero.png',
    },
    editable: true,
    locale: 'en',
    onPreviewPropsChange: () => undefined,
    renderResourcePicker: ({ control }) => {
      calls.push(control.key);
      return React.createElement('button', { type: 'button', 'data-resource-picker': control.key }, `pick ${control.key}`);
    },
  });

  const markup = renderToStaticMarkup(element);
  assert.deepEqual(calls, ['backgroundImage']);
  assert.doesNotMatch(markup, /data-resource-picker="title"/);
  assert.match(markup, /data-resource-picker="backgroundImage"/);
  assert.deepEqual(promptFramePreviewControlResourceSlot(controls[1]), { accept: ['image/*'] });
  assert.equal(promptFramePreviewControlResourceSlot(controls[0]), undefined);
});

test('PromptFramePreviewApp renders the shared preview shell with full-state locale and resource slot wiring', () => {
  const element = React.createElement(PromptFramePreviewApp, {
    initialProps: {
      title: 'Launch',
      backgroundImage: '/hero.png',
    },
    previewEnvelope: {
      durationFrames: 90,
      fps: 30,
      width: 1280,
      height: 720,
      props: {
        title: 'Launch',
        backgroundImage: '/hero.png',
      },
    },
    propsSchema: {
      shape: {
        title: zodLike('ZodString', { description: 'Plain title.' }),
        backgroundImage: zodLike('ZodString', {
          description: 'Background image.',
          promptFrameResource: { accept: ['image/*'] },
        }),
      },
    },
    publicResources: [
      {
        publicPath: '/hero.png',
        sourcePath: 'public/hero.png',
        artifactPath: 'resources/public/hero.png',
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 12,
        sha256: `sha256:${'a'.repeat(64)}`,
      },
      {
        publicPath: '/voice.mp3',
        sourcePath: 'public/voice.mp3',
        artifactPath: 'resources/public/voice.mp3',
        kind: 'audio',
        contentType: 'audio/mpeg',
        sizeBytes: 12,
        sha256: `sha256:${'b'.repeat(64)}`,
      },
    ],
    locale: 'zh',
    renderStage: ({ props, width, height }) => (
      React.createElement('div', { 'data-stage': `${width}x${height}` }, String(props.title))
    ),
  });

  const markup = renderToStaticMarkup(element);
  assert.match(markup, /data-promptframe-preview-app/);
  assert.match(markup, /data-stage="1280x720"/);
  assert.match(markup, />预览</);
  assert.match(markup, /data-promptframe-preview-resource-picker="backgroundImage"/);
  assert.match(markup, /data-promptframe-preview-resource-select="\/hero\.png"/);
  assert.doesNotMatch(markup, /data-promptframe-preview-resource-select="\/voice\.mp3"/);
  assert.doesNotMatch(markup, /data-promptframe-preview-resource-picker="title"/);
});

test('parsePromptFramePreviewInspectorJsonDraft fails closed for invalid JSON and schema mismatch', () => {
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{broken', 'object', 'en'), {
    ok: false,
    error: 'Enter valid JSON.',
  });
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('[]', 'object', 'en'), {
    ok: false,
    error: 'Enter a valid JSON object.',
  });
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{"count":"wrong"}', 'object', 'en', {
    type: 'object',
    properties: {
      count: { type: 'number' },
    },
  }), {
    ok: false,
    error: 'count must be number.',
  });
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{"count":2}', 'object', 'en', {
    type: 'object',
    properties: {
      count: { type: 'number' },
    },
  }), {
    ok: true,
    value: { count: 2 },
  });
});

test('buildPromptFramePreviewControlsFromSchema derives descriptions from Zod-like schema', () => {
  const titleField = zodLike('ZodDefault', {
    description: 'Main title text rendered in the component preview.',
    innerType: zodLike('ZodString', { description: 'Main title text rendered in the component preview.' }),
  });
  const variantField = zodLike('ZodEnum', {
    description: 'Visual treatment selected by the author.',
    values: ['hero', 'compact'],
  });
  const themeField = zodLike('ZodObject', {
    description: 'Nested theme controls.',
    shape: () => ({
      accent: zodLike('ZodString', { description: 'Accent color for foreground elements.' }),
    }),
  });
  const itemsField = zodLike('ZodArray', {
    description: 'Repeated data rows shown by the component.',
    type: zodLike('ZodObject', {
      description: 'One row.',
      shape: () => ({
        label: zodLike('ZodString', { description: 'Row label.' }),
        value: zodLike('ZodNumber', { description: 'Row value.' }),
      }),
    }),
  });

  const controls = buildPromptFramePreviewControlsFromSchema({
    propsSchema: {
      shape: {
        title: titleField,
        variant: variantField,
        theme: themeField,
        items: itemsField,
      },
    },
    defaultProps: {
      title: 'Launch',
      variant: 'hero',
      theme: { accent: '#38bdf8' },
      items: [{ label: 'A', value: 1 }],
    },
  });

  assert.equal(controls.find((control) => control.key === 'title')?.description, 'Main title text rendered in the component preview.');
  assert.equal(controls.find((control) => control.key === 'variant')?.type, 'enum');
  assert.deepEqual(controls.find((control) => control.key === 'variant')?.enumValues, ['hero', 'compact']);
  assert.equal(
    controls.find((control) => control.key === 'theme')?.schema?.properties?.accent?.description,
    'Accent color for foreground elements.',
  );
  assert.equal(
    controls.find((control) => control.key === 'items')?.schema?.items?.properties?.label?.description,
    'Row label.',
  );
  assert.equal(
    controls.some((control) => control.description === 'No prop description was provided; add schema description or metadata.parameterDescriptions.'),
    false,
  );
});

test('buildPromptFramePreviewControlsFromSchema preserves Zod-like promptFrameResource metadata', () => {
  const backgroundField = zodLike('ZodString', {
    description: 'Background image from public resources.',
    promptFrameResource: { accept: ['image/*'], maxFileBytes: 1024 },
  });

  const controls = buildPromptFramePreviewControlsFromSchema({
    propsSchema: {
      shape: {
        backgroundImage: backgroundField,
      },
    },
    defaultProps: {
      backgroundImage: '/hero.png',
    },
  });

  const control = controls.find((candidate) => candidate.key === 'backgroundImage');
  assert.deepEqual(control?.schema?.promptFrameResource, { accept: ['image/*'], maxFileBytes: 1024 });
  assert.deepEqual(promptFramePreviewControlResourceSlot(control), { accept: ['image/*'], maxFileBytes: 1024 });
});

function zodLike(typeName: string, def: Record<string, unknown> = {}) {
  return {
    description: def.description,
    _def: {
      typeName,
      ...def,
    },
  };
}

test('parsePromptFramePreviewInspectorJsonDraft preserves admin schema guardrails', () => {
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{"items":[]}', 'object', 'en', {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
    },
  }), {
    ok: false,
    error: 'title is required.',
  });
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{"title":"Go"}', 'object', 'en', {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 4 },
    },
  }), {
    ok: false,
    error: 'title must be at least 4 characters.',
  });
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{"color":"not-a-color"}', 'object', 'en', {
    type: 'object',
    properties: {
      color: { type: 'string', format: 'color' },
    },
  }), {
    ok: false,
    error: 'color must be a valid color value.',
  });
  assert.deepEqual(parsePromptFramePreviewInspectorJsonDraft('{"mode":"wrong"}', 'object', 'en', {
    type: 'object',
    properties: {
      mode: { const: 'hero' },
    },
  }), {
    ok: false,
    error: 'mode must match the const value.',
  });
});

test('PromptFramePreviewInspector keeps Advanced JSON errors visible in the shared UI source', async () => {
  const source = await readFile(new URL('../src/preview-react.ts', import.meta.url), 'utf8');

  assert.match(source, /data-preview-props-json-error/);
  assert.match(source, /aria-invalid/);
  assert.match(source, /aria-describedby/);
});
