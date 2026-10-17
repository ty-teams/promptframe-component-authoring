import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { COMPONENT_STANDARD_SOURCE_HASH } from '@promptframe/contracts';

export const developmentLimits = { maximumFiles: 64, maximumBytes: 1024 * 1024 };

export async function developmentFixture(root, label = 'captured-title') {
  const files = {
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    'package.json': JSON.stringify({ name: 'captured-component', version: '0.1.0', dependencies: {
      '@promptframe/contracts': '^0.1.28', '@promptframe/component-kit': '^0.1.22',
      react: '^19.0.0', remotion: '^4.0.0', zod: '^3.24.0',
    } }),
    'manifest.json': JSON.stringify({ schemaVersion: 'component-manifest.v0.1.0', standardVersion: 'component-standard.v0.1.0',
      standardSourceHash: COMPONENT_STANDARD_SOURCE_HASH, id: '@demo/captured-component', name: 'captured-component',
      displayName: 'Captured Component', version: '0.1.0', componentType: 'scene_template', author: { id: 'demo', name: 'Demo' },
      description: 'Captured local component.', tags: ['local'], designedDurationRange: { min: 30, max: 120 },
      layout: { contractVersion: 'layout-capability.v0.1.0', layoutMode: 'slot_fill_reflow', recommendedSlot: 'full_screen',
        minReadableSize: { width: 320, height: 180 }, supportedAspectRatios: ['16:9', '9:16', '1:1'],
        layoutAdaptivity: 'responsive', overflowPolicy: 'fit', safeAreaPolicy: 'recommended', confidence: 0.8 },
      entry: { sourcePath: 'src/Component.tsx', componentExport: 'default', propsSchemaPath: 'src/schema.ts',
        sourceHash: `sha256:${'1'.repeat(64)}`, schemaHash: `sha256:${'2'.repeat(64)}` },
      dependencies: {}, peerDependencies: {}, assets: {}, capabilityHints: [], reviewStatus: 'draft', license: 'MIT',
      createdAt: '2026-10-17T00:00:00.000Z' }),
    'src/Component.tsx': `import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
      import { title } from './shared';
      export default function Component() { useCurrentFrame(); useVideoConfig();
        return <AbsoluteFill style={{width:'100%',height:'100%'}}>{title}</AbsoluteFill>; }`,
    'src/shared.ts': `export const title = ${JSON.stringify(label)};`,
    'src/schema.ts': 'import { z } from "zod"; export const PropsSchema = z.object({title:z.string()});',
    'src/index.ts': 'export { default } from "./Component"; export { PropsSchema } from "./schema";',
    'src/preview-props.json': JSON.stringify({ durationFrames: 60, fps: 30, width: 1280, height: 720, props: { title: label } }),
  };
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return Object.keys(files);
}
