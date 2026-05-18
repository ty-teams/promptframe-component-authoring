# @promptframe/component-kit

Stable helper package for Remotion marketplace component authors.

This package is intentionally small. It exposes standard stamps, preview constraints, and deterministic timing helpers that external/private components can depend on without importing renderer internals.

## Public Entrypoints

```ts
import { getComponentStandardStamp } from '@promptframe/component-kit';
import { COMPONENT_PREVIEW_CONSTRAINTS } from '@promptframe/component-kit/preview';
import { createDurationTimeline } from '@promptframe/component-kit/timing';
```

The package does not replace server-side admission. Uploads must still pass build admission, deterministic security review, manifest/schema/policy validation, evidence indexing, artifact mirror, and `get_component_schema` before Director can use the component.

## Authoring Rules

- Do not import `@remotion-media/renderer` or repo-internal paths from component packages.
- Keep Remotion/React as the component project's own dependencies; `component-kit` declares them as optional peers only for future helper compatibility.
- Treat `getComponentStandardStamp()` as a local development stamp. The platform API and server admission remain the final SSOT.
- Use `component-market validate --online` before upload and `component-market upload` for admission.

## Publishing Status

The package is published publicly. The confirmed public coordinates are:

- npm package: `@promptframe/component-kit`
- npm org/scope: `@promptframe`
- current version: `0.1.2`
- release repository: `https://github.com/ty-teams/promptframe-component-kit`
- license: MIT

The initial npm release is complete, and npm Trusted Publisher is configured for `ty-teams/promptframe-component-kit` / `publish-component-kit.yml` / `npm-production`. Future releases should use GitHub Actions Trusted Publishing.

Marketplace/private components themselves do not publish to npm. They still move through platform CLI upload, build admission, security review, schema/policy/receipt generation, evidence indexing, artifact mirror, and resolver-backed preview/render.
