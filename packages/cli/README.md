# @promptframe/cli

PromptFrame component authoring CLI.

Use it to inspect the public component standard, check component folders, validate manifests, inspect the local preview envelope, package source archives, upload components, check build status, rebuild evidence indexes, and rerun layout/security probes.

Current source baseline is `@promptframe/cli@0.1.62`, `@promptframe/contracts@0.1.30`, `@promptframe/component-kit@0.1.24`, and `create-promptframe-component@0.1.52`. The published CLI consumes the contracts AST-aware public security policy evaluator, reports `securityPolicyDigest` / `securityEvaluatorMode` in JSON output, rejects red-team browser capability vectors such as Image/Audio beacons, Worker/SharedWorker, `window.open`, `postMessage`, dynamic script/iframe creation, browser fingerprinting, storage/cookie access, and dangerous HTML, reports `publicResources` for component-level public assets, keeps native `<img>` / `<video>` source checks case-sensitive so Remotion `<Img>` / `<Video>` remain valid, validates preview props against statically declared `propsSchema` fields and requires readable public prop descriptions, enforces strict Slot-first layout/source diagnostics, supports endpoint discovery, project list/current diagnostics, self-service CI token create/list/revoke, single-component and workspace GitHub workflow setup with `promptframe-workflow-version: 2`, `setup-ci --upgrade` stale-template repair, dynamic workspace matrix discovery, `RUNNER_LABELS` and pnpm 10 workflow support, pnpm workspace root lockfile evidence without component symlinks, `promptframe-workspace.json` validation, workspace root `check .` / `upload .` auto-detection, explicit `workspace:*` shared-package diagnostics, workspace upload source metadata headers, packages sanitized lockfile evidence for platform admission, release notes forwarding to upload, stderr NDJSON upload progress for `--json`, human-readable token kind/expiry summaries for `login`, `whoami`, and authenticated `upload`, server version auto-bump notes, and supports `status --fail-on-build-failed` for CI build-status gating.

```bash
npm install -D @promptframe/cli
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
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
npx promptframe upload ./component.zip --target project_private_generation --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
npx promptframe logout
```

Endpoint resolution is explicit and public-safe:

1. `--endpoint`
2. `PROMPTFRAME_API_BASE`
3. `REMOTION_MEDIA_API_BASE`
4. local config written by `promptframe configure --endpoint <url>`
5. secret-free `.promptframerc` in the current directory or a parent directory

The CLI embeds no production, Tailscale, local Docker, or private PromptFrame endpoint default. `dev .` starts the component template's local Vite preview shell. `check .` runs the local public policy checks, reports standard freshness for the selected upload lane, and emits deterministic `localReusability` diagnostics so low-reuse marketplace submissions are visible before upload. If no platform endpoint is available, `dev` / `check` return `standard.freshness.offline_degraded` as a warning instead of pretending the online standard was verified. `preview .` reads `src/preview-props.json` and reports the local preview envelope; `preview . --write-local-report` also validates saved `.promptframe/local-previews/*.json` cases and writes `.promptframe/local-previews/preview-report.json` for local author evidence. Neither command runs a custom runtime or replaces the platform iframe preview/render pipeline. Upload success only means the platform accepted the source package for trust-pipeline admission; use `status`, `reindex`, and `probe` to inspect build readiness, evidence/search readiness, and layout/security diagnostics.

Formal platform endpoints use bearer authentication. `promptframe login --endpoint <url>` starts a one-time browser login code flow through `/cli/auth/device/start`: open the printed URL, approve the code in an already signed-in PromptFrame browser session, and the CLI polls `/cli/auth/device/poll` until it receives a short-lived human CLI token. Platform-issued human CLI tokens expire within 24 hours. The token secret is stored only in the local PromptFrame config file with `0600` permissions and is never printed to stdout or JSON output. `promptframe login --endpoint <url> --token <token>` remains supported for already issued CLI/CI tokens and verifies them through `/cli/auth/whoami`; `promptframe whoami` shows the current platform identity and token kind/expiry without printing the token secret; `promptframe logout` revokes the current token and clears the matching local credential. Dev-header flags such as `--auth-roles` and `--auth-permissions` are local smoke helpers only and are rejected before transport for formal non-local endpoints.

The platform derives tenant, user, and project from the browser-approved CLI token or scoped CI token. External authors should not hand-enter internal IDs, and formal endpoints reject dev identity headers. `whoami --json` is the safe way to inspect the current token kind, display identity, endpoint, scopes, upload targets, and project binding without exposing the token secret. `discovery --json` reports endpoint capabilities, and `project list --json` / `project current --json` report accessible projects. Server-side project switching is not a public CLI contract yet, so the CLI does not pretend that local config can override the platform principal. CI tokens are project-scoped automation credentials; store them in secret managers such as GitHub Actions secrets, not in source files.

Project context is a source-safe convenience file, not a credential. After login, run:

```bash
npx promptframe init . --endpoint "$PROMPTFRAME_API_BASE" --json
```

This writes `.promptframerc` with schema `promptframe-project-context.v0.1.0`, endpoint, tenant/project identifiers, project namespace, default upload target, and workspace config name. It must not contain token secrets, cookies, passwords, API keys, authorization headers, Auth0 subjects, or CI token material. Tokens stay in the local CLI config or CI secret store.

Project components are explicit declarations owned by the platform Project:

```bash
npx promptframe component create @project-namespace/my-component --display-name "My Component" --json
npx promptframe component list --json
```

`component create` and `component list` use bearer auth and do not send owner override fields. CI upload of an undeclared component can fail with `component_registry.not_declared`; create the component first from Admin Project Setup or with `promptframe component create`.

After browser login, authors can create and manage their own project-scoped CI tokens without asking an administrator:

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

`ci-token create` is the only self-service command that returns a token secret, and it is shown once. `ci-token list`, `ci-token revoke`, `whoami`, `discovery`, and `project` diagnostics do not print token secrets or token digests.

`upload` defaults to `--target marketplace_authoring`, the external authoring lane. `--target marketplace --strict` is accepted as the public strict authoring alias and resolves to the same lane. Director Component Author jobs must use `--target project_private_generation` so the server can keep the component project scoped. Unknown targets fail locally before network transport with diagnostic code `upload.target.invalid`; stale PromptFrame authoring package floors are checked before network transport for both component folders and source zip archives. Upload also checks the platform `/components/standard` source hash before sending the package bytes; stale local standards fail with `standard.freshness.upload_blocking`. The platform repeats the same admission checks and remains the final authority.

Upload targets are authorization boundaries, not just labels. A scoped token may be limited to `marketplace_authoring`, `project_private_generation`, or another platform-supported lane. If the request target is outside the token's allowed targets, the platform rejects the upload with a stable authorization diagnostic before build admission.

Component resource support is intentionally conservative. Use props, safe fallback values, platform-managed asset references, or the component-level `public/` resource contract. Files under `public/` are reported in `validate --json`, `check --json`, `package`, and directory `upload --json` as `publicResources`; unsupported extensions, unsafe SVG, path traversal, excessive file count, oversized files, and total-size overflow fail locally before transport. Component code should use `promptFramePublicResource(props, '/logo.png', fallback)` from `@promptframe/component-kit`. After platform build admission accepts those files, preview/render receive platform-managed runtime URLs; `status` / build diagnostics remain the final authority for runtime hosting, URL injection, and rejection reasons. Avoid raw external URLs and raw `fetch()`; if a component needs dynamic data, wait for a platform-mediated API and allowlist.

The upload-to-publish lifecycle has multiple gates. `upload` returning success means the source package was received and build admission started; it does not mean the component is searchable, preview-ready, render-ready, or public. Human-mode upload prints progress phases to stderr while it packages, checks the platform standard, uploads the archive, and receives the platform build id. Authenticated human-mode upload also prints a non-secret token summary (`kind`, `tokenId` when locally known, and expiry when locally known). `--json` keeps stdout as one parseable final JSON object and includes the same non-secret auth summary when available. If the platform resolves a version conflict or auto-bumps a component version, human output prints the requested and accepted versions; JSON output exposes the same information as `versionOutcome`. Use `status <buildId> --json` for build/admission diagnostics, `reindex <buildId> --json` for evidence/search refresh, and `probe <buildId> --json` for layout/security preview diagnostics. Common failure codes include stale standard freshness, missing credentials, invalid upload target, blocked security rules, manual review, and build admission failures.

`package` excludes raw package-manager lockfiles from the public source zip, but when a root lockfile exists it adds `promptframe-lockfile-evidence.json`. The receipt contains only file names, sizes, and SHA-256 hashes so the platform can audit lockfile presence without exposing registry URLs or the full dependency tree in the source archive.

`setup-ci --provider github` writes `.github/workflows/promptframe-component.yml` for a component project. Pull requests run check-only diagnostics and GitHub annotations; `main` and release-style tag pushes upload with `${{ secrets.PROMPTFRAME_CI_TOKEN }}` against `${{ vars.PROMPTFRAME_API_BASE }}`. Add those values in GitHub repository settings. Do not paste the CI token into the workflow, README, issue, or component source.

### Repository layouts and monorepos

#### 根开发服务（源码入口）

工作区根目录声明 `promptframe-workspace.json` 后，源码中的根开发入口使用一个 Vite watcher 管理全部模块：

```bash
promptframe dev . --studio-origin https://studio.example
```

入口监听一个 loopback 地址，端口 `0` 由系统选择一个实际端口，也可用 `--port` 指定。成功监听后输出实际 URL、连接 ID、精确 Studio Origin 和十分钟连接凭据。凭据只用于本机显式连接，不是平台登录或上传 Token；不要提交或放进组件代码。远程浏览器、SSH/WSL 和 HTTPS 到本机的访问仍需真实桥接及浏览器许可，不能根据命令启动推断可达。

`/__promptframe/registry` 和 `events` 以精确 Host/Origin/Authorization 返回模块的当前捕获版本、checking/checked/failed、固定诊断及明确的 lastChecked。精确版本的 bundle 接口一次返回 Component/schema/index ESM、共享 chunk 和已捕获 public 资源；输出不附原包锁或连接凭据。原始 Vite 文件、`/@fs`、默认 HTML/HMR、子配置和 npm 脚本入口关闭。

每个模块先捕获自身文件、实际 workspace pnpm 锁和声明，再运行普通 CLI validate、固定 Vite 闭合图构建和当前内容重捕获。漏通知、快速保存或旧构建晚回不能授权旧字节覆盖新版；失败保留明确标记的 lastChecked。检查状态是构建/规则事实，Player 必须在隔离执行后另报实际加载版本。根服务本身尚未提供 Studio 消费端或 Player 加载 ACK，也不代替平台正式 upload/admission。

构建采用 Vite 8.0.10 和自动 JSX，支持捕获内的 JS/TS/JSON 静态图与 `.module.css`。CSS Modules 的类名按捕获版本和文件路径隔离，样式随实际组件挂载和卸载；默认脚手架的 `propsSchema`、命名 index 与 manifest 指定的组件导出会对齐 Player 原有入口。样式只支持本模块类选择器和纯布局、颜色表达式，不解析 CSS import、URL、composition、全局选择器或独立动画时钟；资源仍使用原公共资源 helper。React/ReactDOM/Remotion、zod 及 PromptFrame 公共 runtime 作为明确列出的共享 external，由消费端按兼容合同提供；不从作者 `node_modules` 偷读依赖。其它 npm/本机 alias、父目录源码、普通全局 CSS、`import.meta` 和非字面动态 import 尚不支持，返回确定诊断。锁文件捕获证明实际输入，不冒依赖安装或解析完整性；正式各模块独立包仍走原检查和上传。

默认界为 32 模块、每模块 2048 文件/16MiB 输入、512 文件/8MiB 输出；检查/构建串行并有超时，受检产物保留总量 64MiB，HTTP 传输另有有界预留，最多八个通知连接。关闭时停止 watcher/HTTP，abort 并 join 实际检查/构建子进程后回收自身临时目录。这些本机进程和内容预算不构成 OS/网络或网页执行沙箱，也不声称全进程 heap/RSS 上限。

The default CLI workflow assumes a single component repository: the current directory is the component package and contains `manifest.json`, `package.json`, `src/`, and optional `public/`.

Monorepos are allowed only when component mapping is explicit. `promptframe-workspace.json` is the supported workspace SSOT; it lists each component `id` and relative `path`. `workspace validate` confirms every path exists and every selected directory's `manifest.json` declares the same id before upload. `PROMPTFRAME_CI_TOKEN` authorizes the upload; it does not map a repository, commit, or tag to a component for you.

Create a workspace scaffold:

```bash
npx -y create-promptframe-component@latest ./component-workspace \
  --workspace \
  --component image-particle-remotion \
  --display-name "Image Particle Remotion"
cd component-workspace
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe setup-ci . --provider github --workspace
npx promptframe upload . --workspace-component @marketplace/image-particle-remotion --endpoint "$PROMPTFRAME_API_BASE" --json
```

Add a component to an existing workspace:

```bash
npx promptframe workspace add . components/motion-intro/image-particle-remotion --id @marketplace/image-particle-remotion
npx promptframe workspace validate . --json
```

The path-explicit single-directory form remains valid if you intentionally run inside one component package:

```bash
cd components/motion-intro/image-particle-remotion
npx promptframe upload . --endpoint "$PROMPTFRAME_API_BASE" --json
```

Do not run `promptframe upload .` at a monorepo root unless the root itself is a valid component package. If you use tag triggers, treat the tag only as a CI trigger or human-readable version hint; the upload mapping still comes from `promptframe-workspace.json`, `--workspace-component`, and the uploaded manifest. Workspace uploads send source metadata headers so the platform can record the workspace config, selected component id, component path, and manifest id alongside the build record.

For external CodingAI, the feedback order is: local CLI JSON diagnostics, GitHub Check annotations, Action summary, artifact report, then platform `status` / admission diagnostics. The CLI never needs internal PromptFrame REQ/TASK/QA docs, agent boards, private endpoint defaults, Auth0 subjects, cookies, or token secrets.

Local and remote commands support stable JSON output:

```bash
npx promptframe standard --json
npx promptframe doctor . --json
npx promptframe validate . --json
npx promptframe check . --target marketplace_authoring --json
npx promptframe upgrade . --dry-run --check-latest --json
npx promptframe dev . --dry-run --json
npx promptframe preview . --json
npx promptframe preview . --write-local-report --json
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/my-component --json
npx promptframe login --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe whoami --json
npx promptframe discovery --json
npx promptframe project list --json
npx promptframe init . --json
npx promptframe component list --json
npx promptframe component create @marketplace/my-component --display-name "My Component" --json
npx promptframe ci-token list --status active --json
npx promptframe upload ./component.zip --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe status <buildId> --json
npx promptframe reindex <buildId> --provider-kind cloud_embedding --json
npx promptframe probe <buildId> --level standard --json
npx promptframe logout --json
```

Every JSON response includes a stable `diagnostic.code`, for example `standard.completed`, `doctor.completed`, `validate.completed`, `check.completed`, `upgrade.dry_run`, `dev.ready`, `preview.ready`, `preview.local_report.written`, `login.completed`, `whoami.completed`, `discovery.completed`, `project.list.completed`, `project.current.completed`, `project_context.init.completed`, `component.list.completed`, `component.create.completed`, `ci_token.create.completed`, `ci_token.list.completed`, `ci_token.revoke.completed`, `logout.completed`, `upload.completed`, `status.completed`, `reindex.completed`, or `probe.completed`. `standard --json`, `validate --json`, and `check --json` report the active public security policy metadata; use `securityPolicyVersion`, `securityPolicyDigest`, and `securityEvaluatorMode` to compare release cohorts instead of scraping prose. `validate --json` and `check --json` also report `checkedRuleIds` for the public policy checks they ran. `upgrade --dry-run --json` reports package floor changes without writing files; add `--check-latest` to include scaffold freshness warnings such as `scaffold.template.stale` from `.promptframe/scaffold.json`. `dev --dry-run --json` reports the local preview command without starting a long-running process. JSON failures include `failureReason` and `retryable`. Missing endpoint failures exit with code `2` and use `<command>.endpoint.missing`; missing credentials use `cli.auth.login_required`.

Components generated by `create-promptframe-component` include `.promptframe/scaffold.json` with the create package version, template name, template digest, and creation time. `promptframe doctor . --json` and `promptframe check . --json` surface stale scaffold metadata as a non-blocking warning; regenerate or manually port the latest scaffold shell before relying on an old project as the gold baseline.

`standard --json` also returns `authoringStandardRelease` and `freshness`. These fields are the public SSOT for package floors, upload targets, standard source hash, and local freshness decisions:

- `marketplace_authoring`: external authoring lane; upload still enters the trust pipeline and public publishing requires review.
- `project_private_generation`: Director Component Author lane; upload still enters the trust pipeline but stays project scoped.

`promptframe dev .` evaluates accepted `public/` resources and writes `.promptframe/dev-public-resources.json` plus `src/promptframe-dev-public-resources.generated.ts`. The scaffold PreviewRoot reads the generated module through the component-kit inspector `renderResourcePicker` slot and exposes local resource buttons for text props.
- `freshness.status`: `current`, `warning`, `upload_blocking`, or `security_breaking`.

`validate` and `package` consume public policies from `@promptframe/contracts`: required files, preview limits, deterministic frame-driven source rules, dependency policy, and security policy. Source files are evaluated with the contracts AST-aware security evaluator so alias usage such as `const BC = BroadcastChannel; new BC()` is rejected while ordinary comments or strings mentioning a blocked API do not fail validation. `runtime.deterministic.fps_hardcoded_timing` is a manual-review validation gate: hardcoded frame timing in Remotion contexts fails `validate` with a repair hint to use `secondsToFrames`, `createDurationTimeline`, `createRevealPhases`, `createFillProgress`, or `timeline.at`. JSON, Markdown, and package metadata still use bounded pattern fallback for install scripts, prompt-injection strings, and remote URL signals. These local checks are early author feedback; the platform admission pipeline remains the final trust gate.
