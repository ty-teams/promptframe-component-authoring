import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PromptFramePreviewInspector,
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
