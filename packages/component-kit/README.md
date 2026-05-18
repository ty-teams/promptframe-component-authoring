# @promptframe/component-kit

TypeScript helpers for building PromptFrame-compatible Remotion components.

```bash
npm install @promptframe/component-kit
```

## What It Includes

- Standard version stamps for component metadata, sourced from `@promptframe/contracts`.
- Preview constraints used by PromptFrame component tooling.
- Timing helpers for deterministic Remotion animations.

## Usage

```ts
import { getComponentStandardStamp } from '@promptframe/component-kit';

export const manifest = {
  name: 'sales-funnel-scene',
  standard: getComponentStandardStamp(),
};
```

```ts
import { COMPONENT_PREVIEW_CONSTRAINTS } from '@promptframe/component-kit/preview';

export const previewSize = COMPONENT_PREVIEW_CONSTRAINTS.defaultStill;
```

```ts
import { createDurationTimeline } from '@promptframe/component-kit/timing';

const timeline = createDurationTimeline({
  durationInFrames: 180,
  fps: 30,
});
```

## Entrypoints

```ts
import { getComponentStandardStamp } from '@promptframe/component-kit';
import { COMPONENT_PREVIEW_CONSTRAINTS } from '@promptframe/component-kit/preview';
import { createDurationTimeline } from '@promptframe/component-kit/timing';
```

## Peer Dependencies

`react` and `remotion` are optional peer dependencies. Component projects should install the versions they build and preview with.

## Component Workflow

Use this package while authoring components. Use the PromptFrame CLI to validate, package, and upload finished components.
