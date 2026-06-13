# @promptframe/component-kit

TypeScript helpers for building PromptFrame-compatible video components.

```bash
npm install @promptframe/component-kit
```

## What It Includes

- Standard version stamps for component metadata, sourced from `@promptframe/contracts`.
- Preview constraints used by PromptFrame component tooling.
- Bounded local preview case matrix helpers for aspect and default-props stress checks.
- `public/` resource lookup helper for runtime-injected component resources with local-dev fallback.
- Timing helpers for deterministic fps-aware timing and frame-driven animations.
- Public style helpers backed by `@promptframe/contracts`.

## Usage

```ts
import { getComponentStandardStamp } from '@promptframe/component-kit';

export const manifest = {
  name: 'sales-funnel-scene',
  standard: getComponentStandardStamp(),
};
```

```ts
import { promptFramePublicResource, type PromptFrameRuntimeResourceProps } from '@promptframe/component-kit';

type Props = PromptFrameRuntimeResourceProps & {
  title: string;
};

export function Component(props: Props) {
  const logoSrc = promptFramePublicResource(props, '/logo.png', '/fallback-logo.png');
  return logoSrc;
}
```

```ts
import { COMPONENT_PREVIEW_CONSTRAINTS, createPreviewCaseMatrix } from '@promptframe/component-kit/preview';

export const maxPreviewWidth = COMPONENT_PREVIEW_CONSTRAINTS.maxWidth;

export const previewCases = createPreviewCaseMatrix({
  basePreview: { durationFrames: 120, fps: 30, width: 1280, height: 720 },
  baseProps: { title: 'Quarterly revenue' },
  fpsPresets: [30, 60],
  validateProps: (candidate) => candidate,
});
```

```ts
import { createDurationTimeline, secondsToFrames } from '@promptframe/component-kit/timing';

const timeline = createDurationTimeline({
  actualDuration: 180,
  designedDuration: secondsToFrames(4, 30),
});
const introEnd = secondsToFrames(1.5, 30);
```

Use `fpsPresets` for local fps-adaptive diagnostics such as 30fps / 60fps comparisons. Source `src/preview-props.json` remains governed by the current public preview policy; do not save or upload 60fps local preview cases until the public standard explicitly allows them.

```ts
import { resolvePromptFrameStyle } from '@promptframe/component-kit/style';

const style = resolvePromptFrameStyle({ tone: 'tech', accentColor: '#38bdf8' }, {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 180,
});
```

## Entrypoints

```ts
import { getComponentStandardStamp } from '@promptframe/component-kit';
import { COMPONENT_PREVIEW_CONSTRAINTS, createPreviewCaseMatrix } from '@promptframe/component-kit/preview';
import { createDurationTimeline } from '@promptframe/component-kit/timing';
import { resolvePromptFrameStyle } from '@promptframe/component-kit/style';
```

## Peer Dependencies

`react` and `remotion` are optional peer dependencies. Component projects should install the versions they build and preview with.

## Component Workflow

Use this package while authoring components. Use the PromptFrame CLI to validate, package, and upload finished components.
