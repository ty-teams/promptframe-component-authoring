import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  COMPONENT_STANDARD_SOURCE_HASH,
  COMPONENT_STANDARD_VERSION,
  evaluatePromptFrameLayoutPolicy,
  LAYOUT_CAPABILITY_VERSION,
  publicPolicyRuleIdSchema,
} from '../dist/index.js';

function manifest(overrides = {}) {
  return {
    schemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    standardVersion: COMPONENT_STANDARD_VERSION,
    standardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    id: '@marketplace/layout-policy-demo',
    name: '@marketplace/layout-policy-demo',
    displayName: 'Layout Policy Demo',
    version: '0.1.0',
    componentType: 'scene_template',
    author: {
      id: 'author-layout',
      name: 'Layout Author',
    },
    description: 'Reusable layout policy demo component.',
    tags: ['layout', 'policy'],
    designedDurationRange: { min: 90, max: 180 },
    entry: {
      sourcePath: 'src/Component.tsx',
      componentExport: 'default',
      propsSchemaPath: 'src/schema.ts',
      sourceHash: `sha256:${'a'.repeat(64)}`,
      schemaHash: `sha256:${'b'.repeat(64)}`,
    },
    dependencies: {},
    peerDependencies: {},
    assets: {},
    capabilityHints: [],
    license: 'MIT',
    createdAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

const goodLayout = {
  contractVersion: LAYOUT_CAPABILITY_VERSION,
  recommendedSlot: 'card',
  minReadableSize: { width: 320, height: 180 },
  supportedAspectRatios: ['16:9', '1:1'],
  layoutAdaptivity: 'responsive',
  overflowPolicy: 'fit',
  safeAreaPolicy: 'recommended',
  confidence: 0.8,
};

function codes(report) {
  return report.diagnostics.map((diagnostic) => diagnostic.code).sort();
}

test('strict layout policy hard-fails missing manifest layout without breaking manifest parser', () => {
  const report = evaluatePromptFrameLayoutPolicy({
    manifest: manifest(),
    componentSourceText: 'export function Component() { return <AbsoluteFill />; }',
  });

  assert.equal(report.accepted, false);
  assert.ok(codes(report).includes('component.layout.manifest_required'));
  assert.ok(publicPolicyRuleIdSchema.options.includes('component.layout.manifest_required'));
});

test('strict layout policy validates complete layout capability fields', () => {
  const report = evaluatePromptFrameLayoutPolicy({
    manifest: manifest({
      layout: {
        recommendedSlot: 'card',
        supportedAspectRatios: ['16:9'],
      },
    }),
  });

  assert.equal(report.accepted, false);
  assert.ok(codes(report).includes('component.layout.manifest_invalid'));
});

test('layout scanner catches root fixed dimensions and viewport slot escape', () => {
  const report = evaluatePromptFrameLayoutPolicy({
    manifest: manifest({ layout: goodLayout }),
    componentSourceText: [
      'import { AbsoluteFill } from "remotion";',
      'export default function Component() {',
      '  return <AbsoluteFill style={{ width: 440, height: 290, minHeight: "100vh" }} />;',
      '}',
    ].join('\n'),
  });

  assert.equal(report.accepted, false);
  assert.ok(codes(report).includes('component.layout.root_fixed_size'));
  assert.ok(codes(report).includes('component.layout.root_viewport_unit'));
});

test('layout scanner catches global CSS and CSS animation timelines', () => {
  const report = evaluatePromptFrameLayoutPolicy({
    manifest: manifest({ layout: goodLayout }),
    files: [
      {
        path: 'src/Component.module.css',
        sourceText: [
          ':global(body) { margin: 0; }',
          '.root { transition: opacity 200ms ease; }',
          '@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }',
        ].join('\n'),
      },
    ],
  });

  assert.equal(report.accepted, false);
  assert.deepEqual(codes(report), [
    'component.animation.css_timeline_forbidden',
    'component.style.global_css_forbidden',
  ]);
});

test('layout scanner classifies high-risk naked px while allowing hairline and svg contexts', () => {
  const rejected = evaluatePromptFrameLayoutPolicy({
    manifest: manifest({ layout: goodLayout }),
    files: [
      {
        path: 'src/Component.module.css',
        sourceText: '.root { padding: 72px; font-size: 48px; border: 1px solid currentColor; }',
      },
    ],
  });
  assert.equal(rejected.accepted, false);
  assert.ok(codes(rejected).includes('component.layout.naked_px_high_risk'));

  const accepted = evaluatePromptFrameLayoutPolicy({
    manifest: manifest({ layout: goodLayout }),
    files: [
      {
        path: 'src/Component.module.css',
        sourceText: '.root { border: 1px solid currentColor; stroke-width: 2px; }',
      },
    ],
  });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.diagnostics, []);
});
