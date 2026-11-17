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

CLI 不内置正式或私有端点默认值。使用 `--endpoint`、`PROMPTFRAME_API_BASE`、`REMOTION_MEDIA_API_BASE`、`promptframe configure --endpoint <url>`，或 `promptframe init` 写入的不含凭据的 `.promptframerc` 指定端点。正式平台使用浏览器设备码登录取得的 Bearer 凭据、`PROMPTFRAME_CI_TOKEN` 或 `PROMPTFRAME_CLI_TOKEN`；开发身份请求头仅用于本地 smoke 端点，正式非本地端点会拒绝。

`promptframe login --endpoint <url>` 通过浏览器 Device Code 流程登录并在本机保存个人 CLI 凭据。新签发的个人凭据默认有效期为 30 天，具体到期时间以平台返回的 `expiresAt` 为准；不会自动续期，也不会追溯延长既有凭据。CI Token 保留显式到期时间，设备短码和 Web 会话各自使用原期限。

`promptframe login --endpoint <url> --token <token>` 用于保存已在其它入口签发的凭据。`login`、`whoami` 和可读格式的 `upload` 输出在可确认时显示 Token 种类及到期时间，不输出凭据原文。不要把 Token、Cookie、密码或其它凭据写入源码、README、issue、提示词或工作流日志。

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

结构、共享源码、npm、CI 与历史源码恢复的统一选择见 [作者决策表](AUTHORING.md#authoring-decisions)。固定版本沿对应发行 tag 阅读同一节。

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

候选与发行tag不移动、不删除。候选尚无资产时，可修复构建脚本并使用下一-rN候选tag，保留失败记录；包字节一旦固定，包本身变更通过新版本向前修复。仅发行控制脚本修复且候选字节未变时，可把新授权绑定同一releaseId的下一-rN发行tag，复用原包及摘要。先核原run、回执和精确registry状态；发布效果未知只观察，不借修复tag盲重写或倒拨latest。

候选通过受影响测试、打包检查和版本验收后，由既有 Trusted Publisher workflow 经OIDC发布本次显式选择的包。v2发行元数据按包名绑定候选、真实依赖图和复用的已公开版本，不要求四包同时升版；v1完整回执仍可读取。每个包的发布跨发行tag串行，进入后重新核精确版本和integrity。已公开且摘要相同的版本直接复用，即使latest已前移；较旧发行不倒拨latest。已发出写入但未确认时只观察原run和精确版本，不自动重发。平台采用值保留完整已验证的四项组合及文档来源，部分发布成功不冒完整可用；所有相关运行时就绪后再切换stable。

Candidate-aware platform endpoints expose a deployment `candidate` stage separately from the immutable package release digest. A compatible CLI reports `standard.release.promoting`, exact cohort versions, and platform release responsibility until the stable receipt is complete; it must not present that state as stable/current completion. Historical recovery creates a new versioned cohort and repeats this path instead of rewinding dist-tags.

版本与兼容性：运行 `promptframe standard --json` 查看所安装CLI携带的离线发行元数据，运行 `promptframe check .` 核对平台标准和各包最低版本。已生成项目的package.json声明其实际依赖，推荐组合变化不会要求所有包同步升版；保留pnpm workspace root lockfile evidence及正常安全检查。

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
