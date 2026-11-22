---
name: component-authoring
description: Build, validate, package, upload, and debug PromptFrame marketplace/private video components. Use this skill for external CodingAI and Director coding mode when authoring user components.
metadata:
  runtime: developer
  visibility: public
  audience: coding-ai
---

# PromptFrame Component Authoring

Use this skill when creating a PromptFrame component. A component is authored as source code, then submitted to the PromptFrame platform for build admission, security review, evidence indexing, artifact storage, schema lookup, preview, and render.

## AI-First Authoring Boundary

Assume the human user is the visual reviewer and product judge. The CodingAI is the component author that turns the brief, user assets, public authoring skill, platform standard API output, and CLI diagnostics into a reusable component.

为当前作品制作的镜头可使用 `project_private_generation`。有公开发布意图时采用 `marketplace_authoring`，设计可复用的参数、响应式布局和默认示例，按相应准入检查提交。实拍或已定稿的离线镜头可直接作为视频素材编排。

The CodingAI must not read PromptFrame internal platform source, agent board, REQ/TASK/QA docs, inboxes, private prompts, secrets, deployment scripts, or internal endpoint defaults.

## Read First

接手已有项目时，先在项目内用 `npx --no-install promptframe standard --json` 取得本机 CLI 的 `authoringStandardRelease.releaseId`。平台项目入门给出采用版本的固定文档。需要选工程结构、配置组件上传 CI 或恢复历史源码时，按[作者决策表](https://github.com/ty-teams/promptframe-component-authoring/blob/main/AUTHORING.md#authoring-decisions)对照本机版本和平台能力。

需要在原字幕上改画面、试两版模型或跟原声调切点时，可阅读[脚手架改稿示例](../../examples/director-revisions/README.md)。每例都有可运行输入、参考画面和适用条件。

给已有镜头试自包含 GLB 时，先读目标 Studio 页的模型槽和连接能力。见[在当前镜头直接试模型](../../examples/director-revisions/README.md#在当前镜头直接试模型)。已锁定的组件也可配合这个选择入口。

- [rules/timing-ssot.md](rules/timing-ssot.md): deterministic frame timing and duration adaptation.
- [rules/search-metadata.md](rules/search-metadata.md): how metadata, schema, source evidence, visual evidence, and feedback affect component search.
- [rules/schema-recipes.md](rules/schema-recipes.md): schema patterns for metrics, comparisons, funnels, and deltas.

## Technology Stack

关键异步视觉内容须在可能提交占位画面前登记准备。模型沿`usePromptFrameModel`；已能绘制但贴图等仍未就绪时，component-kit 0.1.43起可用同`model-react`入口的`usePromptFramePreparation`。资源/版本（以及依赖的帧）变更须换identity，值在同步layout effect中应用并绘制；取消后不采用晚回值并释放资源。详见AUTHORING的GLB节。未登记的后续Promise、useEffect/RAF绘制没有语义就绪保证，不用sleep或放开fetch规避。

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
npx promptframe login --endpoint <promptframe-api-base>
npx promptframe whoami
npx promptframe init . --endpoint <promptframe-api-base>
npx promptframe component create @project-namespace/my-component --display-name "My Component"
npx promptframe upload . --endpoint <promptframe-api-base>
npx promptframe status <buildId> --endpoint <promptframe-api-base>
npx promptframe status <buildId> --wait --json --endpoint <promptframe-api-base>
```

`status --wait` observes only that existing build, with a default 300-second budget and bounded backoff. `--timeout-seconds` changes the observation budget, and Ctrl-C stops only the observer. Read `wait.state`; failed, manual-action, timed-out and unconfirmed results are not usable-build success. Only a ready result adds a top-level locked `componentRef`. Keep the original build id and inspect its diagnostics instead of repeating upload or build.

Do not guess private service addresses. Endpoint resolution is explicit: command `--endpoint`, then `PROMPTFRAME_API_BASE`, then `REMOTION_MEDIA_API_BASE`, then local config from `promptframe configure --endpoint <url>`, then secret-free `.promptframerc`. If no endpoint is provided, finish local video preview, validation, and local preview envelope checks, then report the missing endpoint.

`promptframe init . --endpoint <promptframe-api-base>` writes `.promptframerc` with schema `promptframe-project-context.v0.1.0`: endpoint, tenant/project ids, project namespace, default upload target, and workspace config name. This file is not a credential. Never put token secrets, cookies, passwords, API keys, authorization headers, Auth0 subjects, or CI token material into `.promptframerc`; use local CLI config or CI secrets for credentials.

Project components are explicit platform declarations. Before CI upload, run `promptframe component create @project-namespace/component-slug --display-name "Name" --json` or use Admin Project Setup. `component create` / `component list` use bearer auth and do not send `tenantId`, `userId`, or `projectId` override fields. If upload returns `component_registry.not_declared`, declare the component first and retry.

Formal platform identity comes from browser Device Code login or a scoped token. Do not hand-fill `tenantId`, `userId`, or `projectId`; formal endpoints reject dev identity headers. Use `promptframe whoami --json` to inspect the current token kind, endpoint, scopes, and project binding without printing the token secret. Store CI token secrets only in secret managers such as GitHub Actions secrets.

The generated local preview shell uses `@remotion/player`, renders object / array props as structured controls with an `Advanced JSON` fallback, and passes `acknowledgeRemotionLicense` so local authoring is not interrupted by repeated prompts. This does not replace the author's responsibility to review the Remotion license for their own usage and distribution model.

Automation can add `--json` to `standard`, `doctor`, `validate`, `check`, `upgrade`, `preview`, `login`, `whoami`, `logout`, `upload`, `status`, `reindex`, and `probe`. Use `dev --dry-run --json` to inspect the local preview command without starting a long-running server. Use `upgrade --dry-run --json` to inspect package floor changes before editing, and add `--check-latest` when you need scaffold freshness diagnostics from `.promptframe/scaffold.json`. Read `diagnostic.code`, `checkedRuleIds`, `securityPolicyDigest`, `securityEvaluatorMode`, `failureReason`, and `retryable` instead of scraping prose logs.

`validate` / `check` use the public security policy from `@promptframe/contracts`; current source candidates evaluate JS / TS / TSX through the contracts AST-aware evaluator. Treat `securityEvaluatorMode: "ast"` and the `securityPolicyDigest` as the public rule-cohort identity. If validation reports a browser or dynamic-code rule such as `browser.broadcast_channel`, `browser.image_beacon`, `browser.worker_context`, `browser.window_open`, `browser.cross_context_message`, `storage.browser_storage`, `dom.dangerous_html`, `code.dynamic_import`, or `code.string_timer`, remove the capability instead of hiding it behind aliases.

## External Collaboration Workflow

Use this section when the component is authored outside the PromptFrame platform by a human plus an external CodingAI. The public repo and public skill must be enough; do not depend on private platform notes.

### Human first run

导演已经选定账号时，从这个已验证的目标取得平台和账号摘要，并按[指定账号的登录与上传](https://github.com/ty-teams/promptframe-component-authoring/blob/main/packages/cli/README.md#target-account)传给兼容的 CLI。先检查本机命令和平台能力；已有匹配授权可复用。两个账号有同名项目时也要用目标账号的身份核对。

若本机 CLI 的帮助列出 `accounts`，可用 `accounts list --json` 查看两个客户端的授权，向 CLI 传入当前 MCP 选择返回的 `--account <identityKey>`。只有创作授权时，可用该目标另行批准组件授权。见[共用本机账号目录](https://github.com/ty-teams/promptframe-component-authoring/blob/main/packages/cli/README.md#shared-account-directory)。

```bash
npx -y create-promptframe-component@latest ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
# pnpm workspace users: pnpm install --ignore-workspace
npx promptframe check . --json
npx promptframe preview .
npx promptframe login --endpoint <promptframe-api-base>
npx promptframe init . --endpoint <promptframe-api-base>
npx promptframe component create @project-namespace/my-component --display-name "My Component" --json
npx promptframe upload . --endpoint <promptframe-api-base> --json
npx promptframe status <buildId> --endpoint <promptframe-api-base> --json
```

`promptframe login --endpoint <promptframe-api-base>` starts the browser login code flow for a human author. If the platform has issued a scoped token, `promptframe login --endpoint <promptframe-api-base> --token <token>` can verify and store it without printing the token secret.

Upload targets are authorization lanes. `marketplace_authoring` is the reusable marketplace lane; `project_private_generation` is for project-scoped private generation. A scoped token may be allowed to upload only to specific targets, and the platform enforces that limit.

为当前已配对的作品创作时，从当前导演会话读取并沿用准确 `projectId`、`sessionId`，直接在上传命令附上 `--project-id <projectId> --session-id <sessionId>`，无需用户重新提供。项目已由正常 `init` 写入时可复用该项目，不能按同名作品或最近文件猜会话。CLI 先以冻结的同一凭据核作品目标，平台再在读取 ZIP 前独立核权；失败不退为普通上传。普通项目上传与 CI 不附作品参数。受理活动和构建可用、作品采用及公开发布分别判断；结果未知只查原操作/构建，不重发归档。

Upload success only means the platform received the source package and started build admission. The component is not public until platform diagnostics, evidence readiness, preview/probe checks, review policy, and publish readiness say so. Use `status --json`, `reindex --json`, and `probe --json` rather than guessing from a single upload response.

### GitHub Actions automation

```bash
npx promptframe setup-ci --provider github
```

`promptframe setup-ci --provider github` writes `.github/workflows/promptframe-component.yml`. Configure GitHub repository variable `PROMPTFRAME_API_BASE` and repository secret `PROMPTFRAME_CI_TOKEN`. Pull requests run check-only diagnostics; `main` and release-style tag pushes use the CI token to upload and then call `status`.

Do not paste `PROMPTFRAME_CI_TOKEN` into the workflow, README, source, issue, pull request, prompt, or chat. Do not commit private endpoints. The workflow should reference `${{ secrets.PROMPTFRAME_CI_TOKEN }}` and `${{ vars.PROMPTFRAME_API_BASE }}` only.

### Repository layout choice

独立镜头可以单组件起步。几个组件确实共用颜色、计算或布局代码时，在工作区清单声明 `sharedDirectories`，从工作区根选择组件。只捕获该组件实际引用的共享源码。决定由 CI 上传时，从 Git 根生成并提交工作流；子目录中的模板供复制或生成使用。

Default to a single component repository. The repo root is the component package, and `promptframe check .`, `promptframe upload .`, and `promptframe setup-ci --provider github` all run from that root.

在工作区根只上传当前改动的组件时，传 `--workspace-component <id>`；省略选择会上传清单中的全部组件。CI 矩阵给每个作业传入清单 ID，并核对所选 manifest。

The supported monorepo SSOT is `promptframe-workspace.json`. It lists component ids and relative paths, and `promptframe workspace validate` checks that every path exists and every `manifest.json` id matches before upload.

Create a workspace scaffold:

```bash
npx -y create-promptframe-component@latest ./component-workspace \
  --workspace \
  --component image-particle-remotion \
  --display-name "Image Particle Remotion"
cd component-workspace
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe component create @marketplace/image-particle-remotion --display-name "Image Particle Remotion" --json
npx promptframe setup-ci . --provider github --workspace
npx promptframe upload . --workspace-component @marketplace/image-particle-remotion --endpoint <promptframe-api-base> --json
```

Add an existing component path to a workspace:

```bash
npx promptframe workspace add . components/motion-intro/image-particle-remotion --id @marketplace/image-particle-remotion
npx promptframe workspace validate . --json
```

组件全部输入都在自身目录内时，可在子目录运行以下命令。依赖已声明共享目录时使用上一段的工作区根命令。

```bash
cd components/motion-intro/image-particle-remotion
npx promptframe upload . --endpoint <promptframe-api-base> --json
```

`PROMPTFRAME_CI_TOKEN` 授予相应项目的上传和状态读取权限。平台按每个已选组件记录清单 ID、组件目录与 manifest ID。

### CodingAI feedback locations

查询原构建用 `status <buildId> --wait --json`。本机 `status --help` 列出 `--zip` 时，还可用原 ZIP 找回首次回执中断的构建。需要修改已上传的旧版源码时，先列出本人构建，再按准确的构建号下载到新空目录。见[历史源码恢复步骤](https://github.com/ty-teams/promptframe-component-authoring/blob/main/AUTHORING.md#restore-source)。

External CodingAI should read local CLI JSON diagnostics first. In GitHub Actions, read GitHub Check annotations, the Action summary, the artifact report, and then platform status / admission diagnostics. Treat `ruleId`, `diagnostic.code`, `severity`, `failureReason`, and `retryable` as machine-readable feedback; do not scrape prose logs.

### Public information boundary

Do not read remotion-media internal REQ/TASK/QA, agent board, inboxes, deployment scripts, private prompts, private endpoints, Auth0 subjects, cookies, token secrets, or red-team implementation notes. Do not fill in `userId`, `tenantId`, or `projectId` by hand as identity proof; the platform derives identity from browser login or scoped CI token.

### Third-party component capability boundary

third-party components are not browser extensions. They run as deterministic PromptFrame video components and should only use controlled rendering capabilities. If a requested feature needs raw network access, cross-tab messaging, browser storage, clipboard, WebRTC, notifications, service workers, dynamic imports, dangerous HTML injection, or long-running observers, redesign it around props, platform assets, or a platform-mediated API. Static local checks and GitHub PR checks are early feedback; upload admission, preview runtime pruning, and render sandbox remain final gates.

### Asset and resource truth

本地出图和测试产物可通过组件目录或子目录中的 `.gitignore` 排除，`package` 与目录 `upload` 使用同一选择规则。必需源码、manifest 声明入口和 `public/` 资源被忽略时会明确报错；修正规则，不要删除安全检查或漏传必需资源。

Use JSON props, safe fallback defaults, platform-managed asset references, or the component-level `public/` resource contract. Put small bundled resources under `public/` and resolve them in component code with `promptFramePublicResource(props, '/asset.png', fallback)` from `@promptframe/component-kit`. The CLI reports `publicResources` in `validate/check/package/upload --json`; `promptframe dev .` also writes `.promptframe/dev-public-resources.json` and `src/promptframe-dev-public-resources.generated.ts` so the local PreviewRoot can show public-resource picker buttons for text props. After platform build admission accepts the files, preview/render receive platform-managed runtime URLs. Platform build/status diagnostics remain the final authority for accepted files, hosted URLs and rejection reasons. Do not rely on raw external URLs or component-side `fetch()` unless a platform-mediated API explicitly allows it.

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
- The generated controls expand object / array props into structured groups, fields, and array items by default; use `Advanced JSON` only as a fallback for bulk edits.
- The local preview shell may generate bounded preview cases from `@promptframe/component-kit/preview`, apply only cases that pass `propsSchema.safeParse`, and export saved preview cases into `.promptframe/local-previews/` for author regression only; these files are not source-package evidence and do not replace `src/preview-props.json`.
- `promptframe preview . --json` only verifies the local preview envelope from `src/preview-props.json`; it does not replace platform iframe preview, probes, or render evidence.
- Animation timing must be fps-aware: convert wall-clock seconds with `secondsToFrames(seconds, fps)`, route frame ranges through `createDurationTimeline()` / `timeline.at()`, or use intent helpers such as `createRevealPhases()` and `createFillProgress()`. Local fps-adaptive diagnostics should compare 30fps and 60fps behavior, and local duration diagnostics should check 0.5x / 2x designed-duration behavior before upload.
- Animation must be frame-driven with the platform-compatible hooks and helpers exposed by the template.
- Do not use CSS transitions/keyframes, timers, `Date.now()`, or `Math.random()`.
- Use the template's media primitives rather than browser-native media tags.
- Do not import files outside the component directory.
- Do not access browser storage, cookies, clipboard, camera, microphone, filesystem, process env, or child processes.
- Do not use raw `fetch`, XHR, WebSocket, Beacon, or remote script imports unless the platform provides an explicit mediated API and allowlist.

## Common Diagnostics

When `promptframe validate --json` or platform admission returns one of these diagnostics, fix source code rather than editing metadata or search text:

- `doctor.required_files.missing`: restore `manifest.json`, `package.json`, `src/Component.tsx`, `src/schema.ts`, `src/index.ts`, and `src/preview-props.json`.
- `scaffold.template.stale`: the generated shell metadata says this project came from an older `create-promptframe-component`; run `promptframe upgrade . --dry-run --check-latest --json`, then regenerate or manually port the latest scaffold shell changes.
- `component_standard.source.no_math_random`: replace `Math.random()` with props, frame-derived values, or deterministic seeded helpers.
- `code.eval`, `code.new_function`, `code.string_timer`: remove dynamic string execution; component logic must be deterministic TypeScript/React code.
- `runtime.deterministic.fps_hardcoded_timing`: manual-review validation gate; replace hardcoded frame counts in timing contexts with `secondsToFrames(seconds, fps)`, `createDurationTimeline()` / `timeline.at()`, `createRevealPhases()`, or `createFillProgress()`.
- `network.raw_fetch`: remove raw `fetch`, XHR, WebSocket, EventSource, or Beacon calls unless the platform provides a mediated allowlisted API.
- `prompt.injection_string`: remove comments, README text, or strings that ask the platform to ignore rules, rank the component first, auto-approve, or change admission behavior.
- `network.remote_url`: move hardcoded remote assets into platform asset intake or props; do not bake remote URLs into component source.

## What Director May Use

Director or any Component Author AI may read this skill, user brief, user-provided assets, platform standard API output, and CLI diagnostics. It must not read platform internal agent board, REQ/TASK/QA docs, inboxes, private prompts, deployment scripts, or platform source code.

### Workspace connection lifetime

For a multi-component workspace, use `promptframe dev . --studio-origin <exact-studio-origin>`. One workspace has one local instance, a stable connection ID and a remembered port in 24000–24999. Credentials change on every restart; paste the new connection JSON once in Studio. The service has no fixed ten-minute expiry. With no push clients or requests it exits after 30 minutes (`--idle-timeout <minutes>`, 0 disables). Use `--replace` to normally replace the workspace instance, or `promptframe dev stop .` to close it. Ordinary single-component preview keeps its existing 5173 behavior.

A successful upload does not change existing Spec nodes. Read the exact formal component reference, then remove `componentSource` while updating `componentRef` through the normal Spec edit. After confirming the work uses the formal reference, the local dev instance can be stopped.
