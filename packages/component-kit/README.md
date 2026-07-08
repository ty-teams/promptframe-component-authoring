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
- Shared React preview props inspector for scaffold and platform preview surfaces.

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
import {
  COMPONENT_PREVIEW_CONSTRAINTS,
  createPreviewCaseMatrix,
  describePromptFramePreviewPropControl,
} from '@promptframe/component-kit/preview';

export const maxPreviewWidth = COMPONENT_PREVIEW_CONSTRAINTS.maxWidth;

export const previewCases = createPreviewCaseMatrix({
  basePreview: { durationFrames: 120, fps: 30, width: 1280, height: 720 },
  baseProps: { title: 'Quarterly revenue' },
  fpsPresets: [30, 60],
  durationScalePresets: [0.5, 2],
  validateProps: (candidate) => candidate,
});

export const titleControl = describePromptFramePreviewPropControl(['title'], 'Quarterly revenue');
```

```ts
import {
  createDurationTimeline,
  createFillProgress,
  createRevealPhases,
  secondsToFrames,
} from '@promptframe/component-kit/timing';

const timeline = createDurationTimeline({
  actualDuration: 180,
  designedDuration: secondsToFrames(4, 30),
});
const reveal = createRevealPhases({
  fps: 30,
  timeline,
  enterSeconds: 0.5,
  revealSeconds: 1.5,
  exitSeconds: 3,
});
const fill = createFillProgress({ durationFrames: timeline.actualDuration, startPercent: 0.25, endPercent: 0.75 });
```

`createPreviewCaseMatrix()` returns explicit `caseKind` metadata: `baseline_reset`, `aspect`, `props_stress`, `fps_diagnostic`, and `duration_diagnostic`. Props stress cases should preserve the current author preview aspect/fps in scaffold UI; aspect, fps, and duration diagnostics are separate controls so a human author can see what changed. `probeCoverage` marks whether a case is platform-probe-equivalent or local-authoring-only.

Use `fpsPresets` for local fps-adaptive diagnostics such as 30fps / 60fps comparisons, and `durationScalePresets` for designed-duration probes such as 0.5x / 2x. Source `src/preview-props.json` remains governed by the current public preview policy and must fit `manifest.designedDurationRange`; do not save or upload 60fps local preview cases until the public standard explicitly allows them. Use `describePromptFramePreviewPropControl()` and related preview helpers when building local prop editors so object/array props use structured or JSON fallback editing instead of accidental `[object Object]` strings.

```tsx
import {
  PromptFramePreviewInspector,
  type PromptFramePreviewControl,
} from '@promptframe/component-kit/preview-react';

const controls: PromptFramePreviewControl[] = [
  {
    key: 'title',
    type: 'text',
    label: 'Title',
    description: 'Main headline',
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
          label: { type: 'string', description: 'Visible item label' },
          count: { type: 'number', minimum: 0 },
        },
      },
    },
  },
];

export function PreviewPropsPanel() {
  return (
    <PromptFramePreviewInspector
      controls={controls}
      previewProps={{ title: 'Launch', items: [{ label: 'A', count: 1 }] }}
      editable={false}
    />
  );
}
```

`@promptframe/component-kit/preview-react` is the public UI contract for preview props inspection. It renders stable `data-preview-props-*` selectors, scalar controls, enum/color controls, nested object/array editors, read-only states, missing-description warnings, and fail-closed Advanced JSON parsing. Host products may pass adapters such as `renderResourcePicker` and `renderToolbarActions`, but platform-only permissions, resource governance, Auth0/session state, storage deletion, and review workflow actions must stay in the host surface.

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
import { COMPONENT_PREVIEW_CONSTRAINTS, createPreviewCaseMatrix, describePromptFramePreviewPropControl } from '@promptframe/component-kit/preview';
import { PromptFramePreviewInspector } from '@promptframe/component-kit/preview-react';
import { createDurationTimeline, createFillProgress, createRevealPhases } from '@promptframe/component-kit/timing';
import { resolvePromptFrameStyle } from '@promptframe/component-kit/style';
```

## Peer Dependencies

`react` and `remotion` are optional peer dependencies. Component projects should install the versions they build and preview with.

## Component Workflow

Use this package while authoring components. Use the PromptFrame CLI to validate, package, and upload finished components.
