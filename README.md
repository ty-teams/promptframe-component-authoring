# PromptFrame Component Authoring

Public source repository for PromptFrame component authoring tools.

Repository maintainers and CodingAI should read [AGENTS.md](AGENTS.md) and the
[architecture and development guide](docs/architecture-and-history.md) before changing packages,
templates, the public Skill, or release workflows.

Current packages:

- `@promptframe/component-kit`: small TypeScript helper package for building PromptFrame-compatible video components.
- `@promptframe/contracts`: public component authoring contracts.
- `@promptframe/cli`: component validation, packaging and upload commands.
- `create-promptframe-component`: project scaffolding for component authors.

```bash
npm install @promptframe/component-kit
npm install -D @promptframe/cli create-promptframe-component
```

The package provides version stamps, preview constraints, and deterministic timing helpers. Component projects can depend on it during authoring; finished components are packaged and uploaded with the PromptFrame CLI.

Typical author flow:

```bash
npx -y create-promptframe-component@latest ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
# pnpm workspace users: pnpm install --ignore-workspace
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe sync . --dry-run --json
npx promptframe sync . --apply
npx promptframe preview .
npx promptframe preview . --write-local-report --json
npx promptframe package . --out ./component.zip
npx promptframe login --endpoint https://your-promptframe.example/api-proxy
npx promptframe whoami
npx promptframe discovery
npx promptframe project list
npx promptframe init . --endpoint https://your-promptframe.example/api-proxy
npx promptframe component create @project-namespace/my-component --display-name "My Component"
npx promptframe component list
npx promptframe ci-token create --name "GitHub release" --scope component.upload --scope component.status.read --upload-target marketplace_authoring
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
npx promptframe logout
```

The CLI never embeds a production/private endpoint default. Use `--endpoint`, `PROMPTFRAME_API_BASE`, `REMOTION_MEDIA_API_BASE`, `promptframe configure --endpoint <url>`, or a secret-free `.promptframerc` written by `promptframe init`. Formal platform endpoints use bearer auth from browser code login, `PROMPTFRAME_CI_TOKEN`, or `PROMPTFRAME_CLI_TOKEN`; local dev-header flags are only for local smoke endpoints and are rejected for formal non-local endpoints. `promptframe login --endpoint <url>` starts a browser Device Code flow and stores a human CLI token locally; platform-issued human CLI tokens expire within 24 hours. `promptframe login --endpoint <url> --token <token>` is for a token that was already issued elsewhere. `login`, `whoami`, and human-readable `upload` output show the token kind and expiry when the CLI can determine them, but never print token secrets. Do not paste token secrets into source, README files, issues, prompts, or workflow logs.

Identity and project scope come from the platform session or scoped token. External authors should not hand-fill `tenantId`, `userId`, or `projectId`; formal endpoints reject dev identity headers. Use `promptframe whoami` to inspect the current identity, `promptframe discovery` to inspect endpoint capabilities, and `promptframe project list` / `promptframe project current` to inspect accessible projects. Server-side project switching is not a public CLI contract yet, so the CLI does not pretend that local config can override the platform principal. Upload targets are explicit lanes: `marketplace_authoring` is the reusable external marketplace lane, while `project_private_generation` is for project-scoped private component generation. A scoped token may be limited to specific upload targets, and the server is the final authority.

`promptframe init . --endpoint <url>` writes `.promptframerc` with schema `promptframe-project-context.v0.1.0`: endpoint, tenant/project ids, project namespace, default upload target, and workspace config name. It is intentionally secret-free and safe to review in source; never add token secrets, cookies, passwords, API keys, authorization headers, Auth0 subjects, or CI token material to it. Declare Project-owned components before CI upload:

```bash
npx promptframe component create @project-namespace/my-component --display-name "My Component" --json
npx promptframe component list --json
```

`component create` / `component list` use bearer auth and do not send owner override fields. If CI uploads a component that the Project has not declared, the platform can fail the build with `component_registry.not_declared`; create it first from Admin Project Setup or the CLI.

Authors can create project-scoped automation tokens after browser login:

```bash
npx promptframe ci-token create \
  --name "GitHub release" \
  --scope component.upload \
  --scope component.status.read \
  --upload-target marketplace_authoring \
  --json
npx promptframe ci-token list --status active --json
npx promptframe ci-token revoke <tokenId> --reason "rotating release credential" --json
```

`ci-token create` is the only self-service command that returns a token secret, and it is shown once. Store it in a secret manager such as GitHub Actions secrets; do not paste it into source, README files, issues, prompts, or workflow logs.

`dev .` starts the template's local video preview shell; `check .` validates the component and reports public standard freshness; `preview .` is a local preview envelope check; `preview . --write-local-report` writes `.promptframe/local-previews/preview-report.json` from canonical and saved local preview cases. Neither command replaces the platform iframe preview or render pipeline. Upload success means the platform accepted the source package for trust-pipeline admission; search, preview, render, and publish readiness are reported later by platform status/evidence/probe diagnostics.

Component assets should be passed through JSON props, safe fallback defaults, platform-managed asset references, or the component-level `public/` resource contract. Put small images, audio, video, fonts, JSON, or text files under `public/`; `validate`, `check`, `package`, and directory `upload --json` report a `publicResources` summary with path, type, size, and SHA-256 diagnostics. Component code should resolve resources with `promptFramePublicResource(props, '/logo.png', fallback)` from `@promptframe/component-kit`. After platform build admission accepts those files, preview/render receive platform-managed runtime URLs; `status` / build diagnostics remain the final authority for the accepted files, hosted URLs, and any rejection reason. Do not rely on raw external URLs or component-side `fetch()` unless a platform-mediated API explicitly allows it.

`promptframe dev .` also writes `.promptframe/dev-public-resources.json` and `src/promptframe-dev-public-resources.generated.ts` from the accepted local `public/` files. The generated preview shell reads that module and shows a local public-resource picker for text props, so authors can select `/logo.png`-style paths instead of hand-typing them.

`promptframe sync .` regenerates those same generated authoring files (the thin PreviewRoot shell and the dev public-resources module) without starting the local preview server. It defaults to a dry-run that reports each file's `unchanged` / `would_update` status, including a warning when a legacy fat PreviewRoot shell needs refreshing to the current thin-shell contract; pass `--apply` to write. Useful for CI or scaffold-upgrade checks that only need file drift detection.

The generated local preview shell uses `@remotion/player`, renders object / array props as structured controls with an `Advanced JSON` fallback, and passes `acknowledgeRemotionLicense` so the scaffold does not interrupt local authoring with repeated console prompts. This is only a local preview setting; component authors should still review the Remotion license for their own usage and distribution model.

For automation, add `--json` to `standard`, `doctor`, `validate`, `check`, `upgrade`, `sync`, `preview`, `login`, `whoami`, `logout`, `upload`, `status`, `reindex`, or `probe`. `dev --dry-run --json` reports the local preview command without starting a long-running server. `preview --write-local-report --json` reports `preview.local_report.written`. JSON output includes stable `diagnostic.code`; validation/check output includes `checkedRuleIds`, and JSON failures include `failureReason` plus `retryable`. Generated components include `.promptframe/scaffold.json`; `doctor` / `check` can report `scaffold.template.stale`, and `upgrade --dry-run --check-latest --json` shows scaffold freshness warnings without mutating `package.json`.

GitHub Actions setup:

```bash
npx promptframe setup-ci --provider github
```

This writes `.github/workflows/promptframe-component.yml`. Pull requests run `promptframe check . --json` and publish GitHub annotations / summary only; `main` and release-style tag pushes run `promptframe upload .`. Configure repository variable `PROMPTFRAME_API_BASE` and secret `PROMPTFRAME_CI_TOKEN` in GitHub. The generated workflow references only those names and does not write token values or private endpoints into the repo.

## Repository Layouts

PromptFrame supports two repository styles. Use the simple one unless you have a real multi-component team workflow.

**Single component repository (recommended default):** the repository root is the component package. It contains `manifest.json`, `package.json`, `src/`, and optional `public/`. Run `promptframe check .`, `promptframe upload .`, and `promptframe setup-ci --provider github` from the root. This is the generated scaffold's default shape and is the easiest path for external authors and CodingAI.

**Multi-component repository / monorepo (advanced):** the repository may contain many independent component packages, but each upload must explicitly name one component entry from `promptframe-workspace.json`. The CI token authorizes the request; it does not tell the platform which component changed. Component identity comes from the selected directory's `manifest.json`, and `promptframe workspace validate` blocks manifest/config mismatches before upload. The platform remains the final authority for project, owner, upload target, and admission checks.

Create an advanced workspace scaffold:

```bash
npx -y create-promptframe-component@latest ./component-workspace \
  --workspace \
  --component image-particle-remotion \
  --display-name "Image Particle Remotion"
cd component-workspace
pnpm install
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe setup-ci . --provider github --workspace
npx promptframe upload . --workspace-component @marketplace/image-particle-remotion --endpoint "$PROMPTFRAME_API_BASE" --json
```

Existing monorepos can opt in by adding `promptframe-workspace.json`:

```json
{
  "schemaVersion": "promptframe-workspace.v0.1.0",
  "components": [
    {
      "id": "@marketplace/image-particle-remotion",
      "path": "components/motion-intro/image-particle-remotion"
    }
  ]
}
```

Then run:

```bash
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe upload . --workspace-component @marketplace/image-particle-remotion --endpoint "$PROMPTFRAME_API_BASE" --json
```

The older path-explicit form is still valid when you intentionally work inside one component directory:

```bash
cd components/motion-intro/image-particle-remotion
npx promptframe upload . --endpoint "$PROMPTFRAME_API_BASE" --json
```

Do not run `promptframe upload .` at a monorepo root unless that root is itself a valid single component package. Do not rely on repository names, commit messages, or tag names as the component mapping source. For CI tokens, use `promptframe setup-ci . --provider github --workspace`; it writes a matrix workflow that validates the workspace and uploads each configured component with explicit source metadata headers.

组件开发可使用 CLI JSON diagnostics、GitHub annotations、artifact reports 和平台 status/admission diagnostics。私有平台实现、凭据与部署配置不属于公开作者接口。

## Local Checks

```bash
pnpm install --frozen-lockfile
pnpm lint:public
pnpm -r test
pnpm -r build
pnpm -r lint
pnpm -r pack:dry-run
```

## Releases

PromptFrame authoring packages are published to the public npm registry. Releases are signed through npm Trusted Publishing from GitHub Actions.

Release configuration:

- GitHub repo: `ty-teams/promptframe-component-authoring`
- Environment: `npm-production`
- Candidate workflow: `build-authoring-candidate.yml`, tag `authoring-candidate-<release-suffix>[-rN]`
- Final release tag: `authoring-release-<release-suffix>`
- `@promptframe/contracts`: Trusted Publisher workflow `publish-contracts.yml`
- `@promptframe/component-kit`: Trusted Publisher workflow `publish-component-kit.yml`
- `@promptframe/cli`: Trusted Publisher workflow `publish-cli.yml`
- `create-promptframe-component`: Trusted Publisher workflow `publish-create-component.yml`

A candidate tag builds and tests the whole workspace, packs all four final unpublished versions once, and creates a no-clobber prerelease containing the tarballs plus `candidate-manifest.json`. The manifest binds source commit, package versions, artifact names, sizes, SHA-256, SHA-512 integrity, intent digest, release digest, and expiry. Compatibility checks install those exact tarball bytes; npm `next` is not used to identify a candidate.

Candidate tags are never moved or deleted. If a workflow-file defect prevents every job from being created and no candidate prerelease or asset exists, preserve the failed tag and runs, revise the active intent to the next `-rN` artifact tag, and push that new tag. A candidate revision keeps the same unpublished package cohort but produces a new source-bound manifest; after any candidate asset exists, recovery requires a new versioned cohort instead.

候选通过相关测试、打包检查和版本验收后，发行回执记录 manifest digest 和平台兼容性检查结果。统一的发行 tag 启动四个 Trusted Publisher workflow，校验并发布同一组候选 tarball；依赖包就绪后通过 OIDC 发布为 `latest`，无需长期 npm 写入凭据。部分发布成功时向前补齐：只有官方 integrity 和 `latest` 均与回执匹配，才跳过已存在的版本。四包及官方 registry 的 Docker 运行时全部匹配后，再更新平台 stable 状态。

Candidate-aware platform endpoints expose a deployment `candidate` stage separately from the immutable package release digest. A compatible CLI reports `standard.release.promoting`, exact cohort versions, and platform release responsibility until the stable receipt is complete; it must not present that state as stable/current completion. Historical recovery creates a new versioned cohort and repeats this path instead of rewinding dist-tags.

Current source baseline is `@promptframe/contracts@0.1.39`, `@promptframe/component-kit@0.1.33`, `@promptframe/cli@0.1.71`, and `create-promptframe-component@0.1.61`. `@promptframe/contracts@0.1.39` exposes the public authoring standard release, upload target policy, freshness decision schema, component reusability score schema, style intent contract, public dependency policy, public resource policy/schema, public security policy digest, AST-aware security evaluator subpath, and Slot-first layout diagnostics for strict manifest admission. `@promptframe/component-kit@0.1.33` sources its public standard stamp and style/resource helper contracts from `@promptframe/contracts`, and exposes `createPromptFrameLayout()`, `createPreviewCaseMatrix()`, shared preview prop-control helpers, `PromptFramePreviewInspector`, `buildPromptFramePreviewControlsFromSchema()`, and `promptFramePublicResource()` for runtime resource lookup with local fallback. `@promptframe/cli@0.1.71` includes lifecycle diagnostics, package freshness checks, remote standard source hash checks, local preview reports, preview props/schema unknown-prop validation, required public prop descriptions against the exported `propsSchema`, strict layout/source diagnostics, bearer login, browser login code flow, `whoami` / `logout`, endpoint discovery, project list/current diagnostics, secret-free `.promptframerc` project context init, Project component create/list, self-service CI token create/list/revoke, formal-endpoint dev-header rejection, single-component and workspace GitHub workflow setup with `promptframe-workflow-version: 2`, `setup-ci --upgrade` stale-template repair, dynamic workspace matrix discovery from `promptframe-workspace.json`, `RUNNER_LABELS` and pnpm 10 workflow support, pnpm workspace root lockfile evidence without component symlinks, `promptframe-workspace.json` validation, workspace root `check .` / `upload .` auto-detection, explicit `workspace:*` shared-package diagnostics, source metadata headers for workspace uploads, source validation backed by the contracts AST security evaluator with `securityPolicyDigest` / `securityEvaluatorMode` JSON output, public resource diagnostics, sanitized lockfile evidence packaging for platform admission, case-sensitive native tag checks so Remotion `<Img>` / `<Video>` are not mistaken for raw browser tags, release notes forwarding to upload, stderr NDJSON upload progress for `--json`, marketplace metadata zh/en coverage warning, human-readable token kind/expiry summaries for `login`, `whoami`, and authenticated `upload`, server version auto-bump notes, and `status --fail-on-build-failed` so CI can fail when platform admission fails after upload. `create-promptframe-component@0.1.61` scaffolds Slot-first CSS Module projects with layout helpers, prop-described single-component projects and advanced `--workspace` monorepos with safe append/merge for existing workspace roots, localized local PreviewRoot controls aligned to the Admin Preview Workbench vocabulary, gold-shell contained Remotion Player sizing, schema-description-derived prop labels and descriptions from `propsSchema.describe()`, shared component-kit recursive structured complex props controls, Advanced JSON fallback in local preview, current public contracts, pnpm 10 workspace roots, one-level `components/*` plus optional `packages/*` workspace constraints, v2 root-managed CI workflows that gate failed platform builds and forward version notes, and current CLI dependency floors.

Before publishing, the platform repo should verify the local authoring source through its `pnpm authoring:link-local` gate. After publishing, it should switch back with `pnpm authoring:use-registry` and verify the real npm packages from `https://registry.npmjs.org/`; npm mirrors can lag new versions.

## 工作区开发连接

带有 `promptframe-workspace.json` 的工程使用一个本机服务连接 Studio：

```bash
promptframe dev . --studio-origin https://your-studio.example
promptframe dev . --studio-origin https://your-studio.example --idle-timeout 30
promptframe dev . --studio-origin https://your-studio.example --replace
promptframe dev stop .
```

将启动时输出的完整 JSON 粘贴到同一浏览器主机的 Studio 开发连接面板。服务运行期间连接没有固定十分钟截止；没有推送连接且没有请求持续30分钟后正常退出，`--idle-timeout 0` 可关闭闲置退出。推送心跳默认为25秒。普通单组件 Vite 预览仍使用原5173入口。

工作区默认端口为24000—24999，冲突时在段内选择并记住可用端口；`--port` 优先。`.promptframe/dev/` 保存本机连接ID、端口及实例锁，并自行忽略Git，不含连接凭据。重启后ID保持、凭据重新生成：在Studio重新粘贴一次新JSON即可继续使用同ID节点。旧随机ID的节点需要手动重新绑定一次。本地连接v2需要相容的Studio；旧v1连接仍遵守原有效期。

关闭开发面板不停止连接；切换账号或作品、关闭页面会断开。刷新页面后重新粘贴连接JSON。停止或替换仅操作本工作区的实际实例；无法确认实例退出时命令报错，不自动强制终止进程。

上传组件后，用准确的正式 `componentRef` 替换作品节点引用并移除该节点的 `componentSource`。仅上传成功不会自动改变作品的选源。确认作品已使用正式引用且不再需要本地预览后，可执行 `promptframe dev stop .`。
