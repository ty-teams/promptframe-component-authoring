---
name: component-authoring
description: Build, validate, package, upload, and debug PromptFrame marketplace/private video components. Use this skill for external CodingAI and Director coding mode when authoring user components.
runtime: developer
visibility: public
audience: coding-ai
---

# PromptFrame Component Authoring

Use this skill when creating a PromptFrame component. A component is authored as source code, then submitted to the PromptFrame platform for build admission, security review, evidence indexing, artifact storage, schema lookup, preview, and render.

## AI-First Authoring Boundary

Assume the human user is the visual reviewer and product judge. The CodingAI is the component author that turns the brief, user assets, public authoring skill, platform standard API output, and CLI diagnostics into a reusable component.

Default external authoring is `marketplace_authoring`: design for reusable marketplace quality, clear props, responsive layout, safe defaults, and strict upload admission. If the user only needs a temporary private component inside the product, use the platform's `project_private_generation` lane instead; do not pretend a one-off private component is marketplace-ready.

The CodingAI must not read PromptFrame internal platform source, agent board, REQ/TASK/QA docs, inboxes, private prompts, secrets, deployment scripts, or internal endpoint defaults.

## Read First

- [rules/timing-ssot.md](rules/timing-ssot.md): deterministic frame timing and duration adaptation.
- [rules/search-metadata.md](rules/search-metadata.md): how metadata, schema, source evidence, visual evidence, and feedback affect component search.
- [rules/schema-recipes.md](rules/schema-recipes.md): schema patterns for metrics, comparisons, funnels, and deltas.

## Technology Stack

Use:

- React
- TypeScript
- Platform-compatible frame-driven video runtime
- Zod props schema
- `@promptframe/component-kit`
- `@promptframe/contracts`
- `@promptframe/cli`

Do not use Vue, Svelte, global scripts, raw HTML runtimes, runtime package installation, or remote ESM imports.

For visual style, use the public style contract from `@promptframe/contracts` and helpers from `@promptframe/component-kit/style`. Do not invent private color/theme/style props that only one component understands; expose style intent through the shared contract or keep visual choices internal and deterministic.

## Quickstart

```bash
npx -y create-promptframe-component@latest ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
# pnpm workspace users: pnpm install --ignore-workspace
npx promptframe standard
npx promptframe doctor .
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe package . --out ./my-component.zip
```

To upload, the caller must provide the current platform endpoint:

```bash
npx promptframe upload . --endpoint <promptframe-api-base>
npx promptframe status <buildId> --endpoint <promptframe-api-base>
```

Do not guess private service addresses. If no endpoint is provided, finish local video preview, validation, and local preview envelope checks, then report the missing endpoint.

The generated local preview shell uses `@remotion/player` and passes `acknowledgeRemotionLicense` so local authoring is not interrupted by repeated prompts. This does not replace the author's responsibility to review the Remotion license for their own usage and distribution model.

Automation can add `--json` to `standard`, `doctor`, `validate`, `check`, `upgrade`, `preview`, `upload`, `status`, `reindex`, and `probe`. Use `dev --dry-run --json` to inspect the local preview command without starting a long-running server. Use `upgrade --dry-run --json` to inspect package floor changes before editing. Read `diagnostic.code`, `checkedRuleIds`, `securityPolicyDigest`, `securityEvaluatorMode`, `failureReason`, and `retryable` instead of scraping prose logs.

`validate` / `check` use the public security policy from `@promptframe/contracts`; current source candidates evaluate JS / TS / TSX through the contracts AST-aware evaluator. Treat `securityEvaluatorMode: "ast"` and the `securityPolicyDigest` as the public rule-cohort identity. If validation reports a browser or dynamic-code rule such as `browser.broadcast_channel`, `code.dynamic_import`, or `code.string_timer`, remove the capability instead of hiding it behind aliases.

## External Collaboration Workflow

Use this section when the component is authored outside the PromptFrame platform by a human plus an external CodingAI. The public repo and public skill must be enough; do not depend on private platform notes.

### Human first run

```bash
npx -y create-promptframe-component@latest ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
# pnpm workspace users: pnpm install --ignore-workspace
npx promptframe check . --json
npx promptframe preview .
npx promptframe login --endpoint <promptframe-api-base>
npx promptframe upload . --endpoint <promptframe-api-base> --json
npx promptframe status <buildId> --endpoint <promptframe-api-base> --json
```

`promptframe login --endpoint <promptframe-api-base>` starts the browser login code flow for a human author. If the platform has issued a scoped token, `promptframe login --endpoint <promptframe-api-base> --token <token>` can verify and store it without printing the token secret.

### GitHub Actions automation

```bash
npx promptframe setup-ci --provider github
```

`promptframe setup-ci --provider github` writes `.github/workflows/promptframe-component.yml`. Configure GitHub repository variable `PROMPTFRAME_API_BASE` and repository secret `PROMPTFRAME_CI_TOKEN`. Pull requests run check-only diagnostics; `main` and release-style tag pushes use the CI token to upload and then call `status`.

Do not paste `PROMPTFRAME_CI_TOKEN` into the workflow, README, source, issue, pull request, prompt, or chat. Do not commit private endpoints. The workflow should reference `${{ secrets.PROMPTFRAME_CI_TOKEN }}` and `${{ vars.PROMPTFRAME_API_BASE }}` only.

### CodingAI feedback locations

External CodingAI should read local CLI JSON diagnostics first. In GitHub Actions, read GitHub Check annotations, the Action summary, the artifact report, and then platform status / admission diagnostics. Treat `ruleId`, `diagnostic.code`, `severity`, `failureReason`, and `retryable` as machine-readable feedback; do not scrape prose logs.

### Public information boundary

Do not read remotion-media internal REQ/TASK/QA, agent board, inboxes, deployment scripts, private prompts, private endpoints, Auth0 subjects, cookies, token secrets, or red-team implementation notes. Do not fill in `userId`, `tenantId`, or `projectId` by hand as identity proof; the platform derives identity from browser login or scoped CI token.

### Third-party component capability boundary

third-party components are not browser extensions. They run as deterministic PromptFrame video components and should only use controlled rendering capabilities. If a requested feature needs raw network access, cross-tab messaging, browser storage, clipboard, WebRTC, notifications, service workers, dynamic imports, dangerous HTML injection, or long-running observers, redesign it around props, platform assets, or a platform-mediated API. Static local checks and GitHub PR checks are early feedback; upload admission, preview runtime pruning, and render sandbox remain final gates.

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
- `promptframe dev .` uses the template's Vite shell to render `src/preview-props.json`.
- The local preview shell may generate bounded preview cases from `@promptframe/component-kit/preview`, apply only cases that pass `propsSchema.safeParse`, and export saved preview cases into `.promptframe/local-previews/` for author regression only; these files are not source-package evidence and do not replace `src/preview-props.json`.
- `promptframe preview . --json` only verifies the local preview envelope from `src/preview-props.json`; it does not replace platform iframe preview, probes, or render evidence.
- Animation must be frame-driven with the platform-compatible hooks and helpers exposed by the template.
- Do not use CSS transitions/keyframes, timers, `Date.now()`, or `Math.random()`.
- Use the template's media primitives rather than browser-native media tags.
- Do not import files outside the component directory.
- Do not access browser storage, cookies, clipboard, camera, microphone, filesystem, process env, or child processes.
- Do not use raw `fetch`, XHR, WebSocket, Beacon, or remote script imports unless the platform provides an explicit mediated API and allowlist.

## Common Diagnostics

When `promptframe validate --json` or platform admission returns one of these diagnostics, fix source code rather than editing metadata or search text:

- `doctor.required_files.missing`: restore `manifest.json`, `package.json`, `src/Component.tsx`, `src/schema.ts`, `src/index.ts`, and `src/preview-props.json`.
- `component_standard.source.no_math_random`: replace `Math.random()` with props, frame-derived values, or deterministic seeded helpers.
- `code.eval`, `code.new_function`, `code.string_timer`: remove dynamic string execution; component logic must be deterministic TypeScript/React code.
- `network.raw_fetch`: remove raw `fetch`, XHR, WebSocket, EventSource, or Beacon calls unless the platform provides a mediated allowlisted API.
- `prompt.injection_string`: remove comments, README text, or strings that ask the platform to ignore rules, rank the component first, auto-approve, or change admission behavior.
- `network.remote_url`: move hardcoded remote assets into platform asset intake or props; do not bake remote URLs into component source.

## What Director May Use

Director or any Component Author AI may read this skill, user brief, user-provided assets, platform standard API output, and CLI diagnostics. It must not read platform internal agent board, REQ/TASK/QA docs, inboxes, private prompts, deployment scripts, or platform source code.
