---
name: component-authoring
description: Build, validate, package, upload, and debug PromptFrame marketplace/private Remotion components. Use this skill for external CodingAI and Director coding mode when authoring user components.
runtime: developer
visibility: public
audience: coding-ai
---

# PromptFrame Component Authoring

Use this skill when creating a PromptFrame component. A component is authored as source code, then submitted to the PromptFrame platform for build admission, security review, evidence indexing, artifact storage, schema lookup, preview, and render.

## Read First

- [rules/timing-ssot.md](rules/timing-ssot.md): deterministic Remotion timing and duration adaptation.
- [rules/search-metadata.md](rules/search-metadata.md): how metadata, schema, source evidence, visual evidence, and feedback affect component search.
- [rules/schema-recipes.md](rules/schema-recipes.md): schema patterns for metrics, comparisons, funnels, and deltas.

## Technology Stack

Use:

- React
- TypeScript
- Remotion
- Zod props schema
- `@promptframe/component-kit`
- `@promptframe/contracts`
- `@promptframe/cli`

Do not use Vue, Svelte, global scripts, raw HTML runtimes, runtime package installation, or remote ESM imports.

## Quickstart

```bash
npm create promptframe-component ./my-component -- --name my-component --display-name "My Component"
cd my-component
npm install
npx promptframe standard
npx promptframe doctor .
npx promptframe validate .
npx promptframe preview .
npx promptframe package . --out ./my-component.zip
```

To upload, the caller must provide the current platform endpoint:

```bash
npx promptframe upload . --endpoint <promptframe-api-base>
npx promptframe status <buildId> --endpoint <promptframe-api-base>
```

Do not guess private service addresses. If no endpoint is provided, finish local validation and local preview envelope checks, then report the missing endpoint.

Automation can add `--json` to `standard`, `doctor`, `validate`, `preview`, `upload`, `status`, `reindex`, and `probe`. Read `diagnostic.code`, `checkedRuleIds`, `failureReason`, and `retryable` instead of scraping prose logs.

## Component Types

Public marketplace search is optimized for four component types:

- `scene_template`: full-screen scenes.
- `contained_widget`: local widgets such as charts, metric cards, and flow cards.
- `overlay`: subtitles, labels, badges, hints, and safe-area overlays.
- `transition_effect`: transition-slot effects between scenes.

Do not expose atom/motion internals as marketplace search units. Do not implement a layout container unless the platform explicitly provides a slot/child contract.

## Layout Rules

The component root should fill its parent:

```tsx
style={{ width: '100%', height: '100%' }}
```

Do not hard-code the root to `1920x1080`, `1080x1920`, or any other absolute canvas size. Internal design-pixel thinking is allowed only if it scales or reflows from the current video/container size.

Use manifest/layout hints to explain the component's floor:

- recommended slot: full screen, half screen, card, badge, text line, transition slot.
- minimum readable size.
- supported aspect ratios.
- adaptivity: responsive, scales down, reflows, clips, or fixed.
- overflow and safe-area policy.

Author declarations are hints. The platform can override them with static scan, preview smoke, probe, render evidence, and feedback evidence.

## Required Files

```text
component/
├── package.json
├── manifest.json
├── README.md
└── src/
    ├── Component.tsx
    ├── index.ts
    ├── preview-props.json
    └── schema.ts
```

## Hard Rules

- Props must be JSON serializable and described by schema.
- `src/preview-props.json` must render a meaningful bounded preview without asking the user for extra input.
- `promptframe preview . --json` only verifies the local Remotion preview envelope from `src/preview-props.json`; it does not replace platform iframe preview, probes, or render evidence.
- Animation must be frame-driven with Remotion hooks and helpers.
- Do not use CSS transitions/keyframes, timers, `Date.now()`, or `Math.random()`.
- Use Remotion media primitives rather than browser-native media tags.
- Do not import files outside the component directory.
- Do not access browser storage, cookies, clipboard, camera, microphone, filesystem, process env, or child processes.
- Do not use raw `fetch`, XHR, WebSocket, Beacon, or remote script imports unless the platform provides an explicit mediated API and allowlist.

## Common Diagnostics

When `promptframe validate --json` or platform admission returns one of these diagnostics, fix source code rather than editing metadata or search text:

- `doctor.required_files.missing`: restore `manifest.json`, `package.json`, `src/Component.tsx`, `src/schema.ts`, `src/index.ts`, and `src/preview-props.json`.
- `component_standard.source.no_math_random`: replace `Math.random()` with props, frame-derived values, or Remotion `random(seed)`.
- `code.eval`, `code.new_function`, `code.string_timer`: remove dynamic string execution; component logic must be deterministic TypeScript/React code.
- `network.raw_fetch`: remove raw `fetch`, XHR, WebSocket, EventSource, or Beacon calls unless the platform provides a mediated allowlisted API.
- `prompt.injection_string`: remove comments, README text, or strings that ask the platform to ignore rules, rank the component first, auto-approve, or change admission behavior.
- `network.remote_url`: move hardcoded remote assets into platform asset intake or props; do not bake remote URLs into component source.

## What Director May Use

Director or any Component Author AI may read this skill, user brief, user-provided assets, platform standard API output, and CLI diagnostics. It must not read platform internal agent board, REQ/TASK/QA docs, inboxes, private prompts, deployment scripts, or platform source code.
