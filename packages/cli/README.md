# @promptframe/cli

`check` 和目录上传中的 `localReusability` 使用公共 schema／预设证据。名称、注释和等价参数读取方式不改变提示；缺少证据返回 warning，不单独阻止保存或替代服务端安全及公开审核。`score` 是该阶段的证据覆盖率，具体依据见 `signals`，不是画面质量或公开发布许可。

在项目里运行 `npx --no-install promptframe standard --json`，按 `authoringStandardRelease.releaseId` 选择仓库同名标签，即可查到该 CLI 发行时的手册。持续维护的[作者决策表](https://github.com/ty-teams/promptframe-component-authoring/blob/main/AUTHORING.md#authoring-decisions)另列出本地工具、平台能力和历史源包的适用条件。

`package` 和目录形式的 `upload` 使用所选组件目录及其子目录中的 `.gitignore`，支持嵌套覆盖、`!` 和目录规则；不读取组件目录外的 Git 配置。`node_modules`、`dist`、`.git`、`.promptframe`、`.component-packages` 仍固定排除。将本地出图和测试产物放在明确忽略的目录中。

必需文件、manifest 声明的源码/props schema 和 `public/` 资源不能被静默排除；规则命中时返回 `package.required_file.ignored`，应修正规则后再打包。保留文件仍接受原安全扫描，原始 lockfile 不入包，脱敏 lockfile evidence 保留。

PromptFrame component authoring CLI.

Use it to inspect the public component standard, check component folders, validate manifests, inspect the local preview envelope, package source archives, upload components, check build status, rebuild evidence indexes, and rerun layout/security probes.

运行 `promptframe check . --endpoint "$PROMPTFRAME_API_BASE" --json` 可比较平台标准和各包最低版本。离线 `standard` 读取本机发行资料。项目实际依赖可从包管理器和锁文件核对。

### 终端诊断语言

语言按 `PROMPTFRAME_LANG`、`LC_ALL`、`LC_MESSAGES`、`LANG` 的顺序取首个非空值。支持 `zh`、`en` 及其地区形式（例如 `zh_CN.UTF-8`、`en-US`）；未设置、`C`、`POSIX` 或不支持的语言回退英文。

```bash
PROMPTFRAME_LANG=zh npx --no-install promptframe standard --json
PROMPTFRAME_LANG=en npx --no-install promptframe doctor . --json
```

PowerShell 可先设置 `$env:PROMPTFRAME_LANG = 'zh'`，再运行命令。语言覆盖标准新鲜度、`doctor`、`upgrade`、脚手架过时和常见布局/样式诊断。人读与 JSON 的 `message`、`repairHint` 随语言变化；错误码、严重程度、退出码、路径、版本和可复制命令保持不变。未知诊断保留原文。语言不会改写 manifest、组件 props、源文件或已保存的检查报告。

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
npx promptframe ci-token create --name "GitHub release" --scope component.upload --scope component.status.read --upload-target project_private_generation
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe upload ./component.zip --target project_private_generation --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --wait --json --endpoint https://your-promptframe.example/api-proxy
npx promptframe logout
```

首次上传未拿到构建号时，先保留原 ZIP，再按下方「等待已有构建」中适合本机版本的方式找回原单。

Endpoint resolution is explicit and public-safe:

1. `--endpoint`
2. `PROMPTFRAME_API_BASE`
3. `REMOTION_MEDIA_API_BASE`
4. local config written by `promptframe configure --endpoint <url>`
5. secret-free `.promptframerc` in the current directory or a parent directory

The CLI embeds no production, Tailscale, local Docker, or private PromptFrame endpoint default. `dev .` starts the component template's local Vite preview shell. `check .` runs the local public policy checks, reports standard freshness for the selected upload lane, and emits deterministic `localReusability` diagnostics so low-reuse marketplace submissions are visible before upload. If no platform endpoint is available, `dev` / `check` return `standard.freshness.offline_degraded` as a warning instead of pretending the online standard was verified. `preview .` reads `src/preview-props.json` and reports the local preview envelope; `preview . --write-local-report` also validates saved `.promptframe/local-previews/*.json` cases and writes `.promptframe/local-previews/preview-report.json` for local author evidence. Neither command runs a custom runtime or replaces the platform iframe preview/render pipeline. Upload success only means the platform accepted the source package for trust-pipeline admission; use `status`, `reindex`, and `probe` to inspect build readiness, evidence/search readiness, and layout/security diagnostics.

Formal platform endpoints use bearer authentication. `promptframe login --endpoint <url>` starts a one-time browser login code flow through `/cli/auth/device/start`: open the printed URL, approve the code in an already signed-in PromptFrame browser session, and the CLI polls `/cli/auth/device/poll` until it receives a short-lived human CLI token. 新签发的人工 CLI 凭据默认有效 30 天；显式期限、CI 凭据期限、撤销和既有凭据保持各自实际配置。 The token secret is stored only in the local PromptFrame config file with `0600` permissions and is never printed to stdout or JSON output. `promptframe login --endpoint <url> --token <token>` remains supported for already issued CLI/CI tokens and verifies them through `/cli/auth/whoami`; `promptframe whoami` shows the current platform identity and token kind/expiry without printing the token secret; `promptframe logout` revokes the current token and clears the matching local credential. Dev-header flags such as `--auth-roles` and `--auth-permissions` are local smoke helpers only and are rejected before transport for formal non-local endpoints.

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
  --upload-target project_private_generation \
  --json
npx promptframe ci-token list --status active --json
npx promptframe ci-token revoke <tokenId> --reason "rotating release credential" --json
```

`ci-token create` is the only self-service command that returns a token secret, and it is shown once. `ci-token list`, `ci-token revoke`, `whoami`, `discovery`, and `project` diagnostics do not print token secrets or token digests.

普通 `upload` 缺省为 `--target project_private_generation`，需要明确选定有权使用的项目；普通上传只产生该项目的私有构建，不申请公开。 `--target marketplace --strict` is accepted as the public strict authoring alias and resolves to the same lane. 项目私有的锁定引用可直接用于原项目；显式指定的既有合法上传目标仍按原用途校验。 Unknown targets fail locally before network transport with diagnostic code `upload.target.invalid`; stale PromptFrame authoring package floors are checked before network transport for both component folders and source zip archives. Upload also checks the platform `/components/standard` source hash before sending the package bytes; stale local standards fail with `standard.freshness.upload_blocking`. The platform repeats the same admission checks and remains the final authority.

Upload targets are authorization boundaries, not just labels. A scoped token may be limited to `marketplace_authoring`, `project_private_generation`, or another platform-supported lane. If the request target is outside the token's allowed targets, the platform rejects the upload with a stable authorization diagnostic before build admission.

为当前作品上传组件时，使用已经配对的导演会话给出的准确作品范围：`promptframe upload . --session-id <current-session-id> --project-id <current-project-id> --json`。项目也可来自正常 `init` 写入的 `.promptframerc`。导演沿当前会话直接传入这些值，不让用户重复填写，不按作品名或最近目录猜测。CLI 先用同一凭据确认作品目标，再发送 ZIP；平台在读取 multipart 前再次独立核权。旧平台、错账号或目标回执不一致时不会退回普通上传。`--request-id <intent-id>` 可固定这次明确意图；同命令的不同归档各有独立操作号。丢回执后沿原构建或源摘要查询，不重传。普通项目上传与 CI 不带 `--session-id`，不会把旧资源会话配置关联为作品活动。活动只报告原受理及构建状态，不自动采用到作品或申请公开。

Component resource support is intentionally conservative. Use props, safe fallback values, platform-managed asset references, or the component-level `public/` resource contract. Files under `public/` are reported in `validate --json`, `check --json`, `package`, and directory `upload --json` as `publicResources`; unsupported extensions, unsafe SVG, path traversal, excessive file count, oversized files, and total-size overflow fail locally before transport. Component code should use `promptFramePublicResource(props, '/logo.png', fallback)` from `@promptframe/component-kit`. After platform build admission accepts those files, preview/render receive platform-managed runtime URLs; `status` / build diagnostics remain the final authority for runtime hosting, URL injection, and rejection reasons. Avoid raw external URLs and raw `fetch()`; if a component needs dynamic data, wait for a platform-mediated API and allowlist.

The upload-to-publish lifecycle has multiple gates. `upload` returning success means the source package was received and build admission started; it does not mean the component is searchable, preview-ready, render-ready, or public. Human-mode upload prints progress phases to stderr while it packages, checks the platform standard, uploads the archive, and receives the platform build id. Authenticated human-mode upload also prints a non-secret token summary (`kind`, `tokenId` when locally known, and expiry when locally known). `--json` keeps stdout as one parseable final JSON object and includes the same non-secret auth summary when available. If the platform resolves a version conflict or auto-bumps a component version, human output prints the requested and accepted versions; JSON output exposes the same information as `versionOutcome`. Use `status <buildId> --json` for build/admission diagnostics, `reindex <buildId> --json` for evidence/search refresh, and `probe <buildId> --json` for layout/security preview diagnostics. Common failure codes include stale standard freshness, missing credentials, invalid upload target, blocked security rules, manual review, and build admission failures.

`package` checks the component directory for a lockfile. If the component shares a pnpm workspace root lockfile, leave `pnpm-lock.yaml` at the workspace root. The public source ZIP stores the lockfile name, size, and SHA-256 in `promptframe-lockfile-evidence.json`. The full lockfile, including its registry URLs and dependency tree, stays in the authoring repository. To reproduce the install, use the lockfile matching that digest.

`setup-ci --provider github` writes `.github/workflows/promptframe-component.yml` for a component project. Pull requests run check-only diagnostics and GitHub annotations; `main` and release-style tag pushes upload with `${{ secrets.PROMPTFRAME_CI_TOKEN }}` against `${{ vars.PROMPTFRAME_API_BASE }}`. Add those values in GitHub repository settings. Do not paste the CI token into the workflow, README, issue, or component source.

<a id="shared-account-directory"></a>

### 两个客户端共用本机账号目录

先查看 `promptframe --help` 是否列出 `accounts`。支持该命令的版本可用下列操作。CLI 和 Creation 各自保管自己的凭据，按平台验证的账号合并展示。

```bash
promptframe accounts list --json
promptframe accounts refresh --config "$CLI_CONFIG" --json
promptframe accounts verify --account "$IDENTITY_KEY" --json
promptframe upload ./my-component --account "$IDENTITY_KEY" --json
```

普通登录会登记平台确认的账号。已有配置可用 `accounts refresh` 登记，凭据的有效期沿用原值。列表中的 `stored` 表示本机登记过；当下是否有效可以用 `verify` 查询。CLI 授权缺失时，用同一个 `--account` 发起设备登录，浏览器批准和后续上传都核对目标账号。同一账号有多份 CLI 授权时，可从该行选择 `referenceId` 并传 `--reference-id`。

在支持本机账号选择的创作 MCP 中，导演通过 `promptframe_local_accounts` 查询，再通过 `promptframe_local_select_account` 选择。普通 shell 没有这次 MCP 请求的宿主身份，导演把返回的 `identityKey` 传入 CLI 即可。一次 shell 调用也可以用环境变量 `PROMPTFRAME_ACCOUNT` 表达同一选择。两个 Agent 可以在同一目录独立使用各自的账号。跨进程持久选择归能验证当前会话的宿主管理，shell 的作品 `--session-id` 只表示作品会话。

目录记录授权引用和观察时间。只有原凭据文件的属主、权限和内容与引用匹配，且平台确认了目标账号，CLI 才使用它。无法验证原生 Windows 的文件 ACL 时，目录操作会报告不可用。原有独立配置仍可按下文的 `--expected-identity` 指定目标。

支持「授权与设备」的平台可以显示个人 CLI 的系统类型、CLI 版本和最近核验时间。运行 `whoami` 会核验设备，平台受理组件上传后才会更新最近操作。设备标识在本机随机生成，每个平台、账号和 CLI 配置各自独立。旧平台或本机无法保存设备资料时，认证和上传仍按各自的结果返回。

<a id="target-account"></a>

### 给已选定的账号登录或上传

需要把组件交给指定账号时，在该账号已验证的上下文中取 `accountIdentity`，将原 JSON 对象作为 `--expected-identity` 的值传给本次命令。兼容服务的 `whoami --json` 提供该字段。已连接的创作宿主可用服务端确认的 `platformDigest`、`accountDigest` 和合同版本 `promptframe-account-identity/v1` 组成同一对象。两个账号即便都叫「默认项目」，其账号摘要也各自独立。应先从**要操作的目标**取得摘要，只从待验上传凭证再取一遍会失去这项核对的意义。

```bash
npx --no-install promptframe login --endpoint "$PROMPTFRAME_API_BASE" --expected-identity "$TARGET_IDENTITY" --json
npx --no-install promptframe upload ./component.zip --endpoint "$PROMPTFRAME_API_BASE" --expected-identity "$TARGET_IDENTITY" --json
```

本机帮助须列出 `--expected-identity`，目标平台的 `cli/discovery` 须声明 `accountIdentityBinding`。匹配且权限足够的原授权返回 `reused: true` 和原有效期。需要首次授权时，浏览器批准页会核对所选身份。上传前会用同一份实际凭证核对账号和权限，再发送源包。收到 `cli.auth.account_mismatch` 时选择目标账号自己的 `--config`，或给该账号选择单独的配置执行登录。收到 `cli.auth.identity_binding_unsupported` 时等待目标平台支持此合同，保留原操作的账号条件。

### 按版本申请公开

就绪后对准确构建执行 `npx promptframe public-request <buildId> --reason "公开此版本" --json`，复用原包和产物，不再次上传 ZIP。返回审核单与实际状态；`public_pending` 表示等待审核，只有审核、分发与发布完成才可使用市场正式引用。请求号默认按原构建和理由稳定生成；失去回执时使用同一请求号观察或接续，不换键重复送审。可用 `--request-id` 明确绑定一次请求。

普通推送 CI 仍只上传项目私有版本。需要标签触发送审时，明确设置 `PROMPTFRAME_REQUEST_PUBLIC_ON_TAG=true`，将只有当前项目 `component.public.request` 权限的独立凭据放入 `PROMPTFRAME_PUBLIC_REVIEW_TOKEN`。上传凭据不会自动获得送审权限，送审凭据不能批准申请。既有凭据不自动扩权。

### Repository layouts and monorepos

#### 根开发服务（源码入口）

工作区根目录声明 `promptframe-workspace.json` 后，源码中的根开发入口使用一个 Vite watcher 管理全部模块：

```bash
promptframe dev . --studio-origin https://studio.example
```

入口监听一个 loopback 地址，默认从24000—24999选择工作区稳定端口；`--port 0` 由系统分配端口，也可用 `--port` 显式指定。成功监听后输出实际 URL、稳定连接 ID、精确 Studio Origin 和本次进程新生成的连接凭据。凭据只用于本机显式连接，不是平台登录或上传 Token；不要提交或放进组件代码。远程浏览器、SSH/WSL 和 HTTPS 到本机的访问仍需真实桥接及浏览器许可，不能根据命令启动推断可达。

`/__promptframe/registry` 和 `events` 以精确 Host/Origin/Authorization 返回模块的当前捕获版本、checking/checked/failed、固定诊断及明确的 lastChecked。精确版本的 bundle 接口一次返回 Component/schema/index ESM、共享 chunk 和已捕获 public 资源；输出不附原包锁或连接凭据。原始 Vite 文件、`/@fs`、默认 HTML/HMR、子配置和 npm 脚本入口关闭。

每个模块先捕获自身文件、实际 workspace pnpm 锁和声明，再运行普通 CLI validate、固定 Vite 闭合图构建和当前内容重捕获。漏通知、快速保存或旧构建晚回不能授权旧字节覆盖新版；失败保留明确标记的 lastChecked。检查状态是构建/规则事实，Player 必须在隔离执行后另报实际加载版本。Studio 开发连接面板消费该连接；只有 Player 回报的实际加载版本能证明画面已更新，根服务 checked 状态不代替此回报或平台正式 upload/admission。

同一仓库包含多个作品工作区时，可以在覆盖这些作品的顶层 pnpm 工作区安装一次，再从各作品自己的 `promptframe-workspace.json` 启动 dev。dev 与 package 使用相同的根锁来源：只读取声明覆盖当前组件且 importer 与当前依赖规格匹配的 pnpm 控制文件；缺锁、过期 importer、错误归属和符号链接返回明确错误。父级锁与工作区声明的变化会重新检查受影响模块，但不会把其它作品加入当前开发连接；原锁内容不会进入公开源码包。

构建采用 Vite 8.0.10 和自动 JSX，支持捕获内的 JS/TS/JSON 静态图与 `.module.css`。CSS Modules 的类名按捕获版本和文件路径隔离，样式随实际组件挂载和卸载；默认脚手架的 `propsSchema`、命名 index 与 manifest 指定的组件导出会对齐 Player 原有入口。样式只支持本模块类选择器和纯布局、颜色表达式，不解析 CSS import、URL、composition、全局选择器或独立动画时钟；资源仍使用原公共资源 helper。React/ReactDOM/Remotion、zod 及 PromptFrame 公共 runtime 作为明确列出的共享 external，由消费端按兼容合同提供；不从作者 `node_modules` 偷读依赖。其它 npm/本机 alias、未声明的父目录源码、普通全局 CSS、`import.meta` 和非字面动态 import 尚不支持，返回确定诊断。锁文件捕获证明实际输入，不冒依赖安装或解析完整性；正式各模块独立包仍走原检查和上传。

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

组件没有跨目录共享源码时可在子目录运行下面的命令。使用 `sharedDirectories` 时，在工作区根用 `--workspace-component` 选择组件。

```bash
cd components/motion-intro/image-particle-remotion
npx promptframe upload . --endpoint "$PROMPTFRAME_API_BASE" --json
```

在有 `promptframe-workspace.json` 的根执行 `upload .` 会依次提交清单中的全部组件，单项上传加 `--workspace-component <id>`。若某项中断，已受理的构建各自保留，先查原单再决定剩余项。CI 标签用于触发工作流，清单和各组件的 manifest 决定上传对象。

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

`validate` and `package` consume public policies from `@promptframe/contracts`: required files, preview limits, deterministic frame-driven source rules, dependency policy, and security policy. Source files are evaluated with the contracts AST-aware security evaluator so alias usage such as `const BC = BroadcastChannel; new BC()` is rejected while ordinary comments or strings mentioning a blocked API do not fail validation. `runtime.deterministic.fps_hardcoded_timing` is a manual-review validation gate: hardcoded frame timing in Remotion contexts fails `validate` with a repair hint to read the actual `useVideoConfig().fps`, derive frames with `Math.round(seconds * fps)`, and use absolute frame positions with Remotion `interpolate()` or `spring()`. JSON, Markdown, and package metadata still use bounded pattern fallback for install scripts, prompt-injection strings, and remote URL signals. These local checks are early author feedback; the platform admission pipeline remains the final trust gate.

<a id="build-status"></a>
## 等待已有构建

CLI 0.1.89 支持按构建号查询。首次回执中断时，可从「我的组件」的本人构建记录核对项目、组件与版本，找到构建号后继续 `status <buildId> --wait --json`。

从包含按摘要查询功能的版本起，`promptframe status --help` 会列出 `--zip` 和 `--source-sha256`。这时也可运行 `promptframe status --zip ./component.zip --wait --json`，或传首次提交时的源包摘要。使用原账号、项目和平台地址；同一 ZIP 用于多个上传目标时加 `--target <原目标>`。只有唯一匹配才会继续等待。需要取回源码字节时，使用[指定历史版本的下载流程](https://github.com/ty-teams/promptframe-component-authoring/blob/main/AUTHORING.md#restore-source)。

`status <buildId>` 保持单次只读。加 `--wait` 后只轮询这一个原构建，默认总预算300秒，`--timeout-seconds`可设置0.1—1800秒；请求和退避都计入预算。Ctrl-C只结束本机观察，不取消、恢复、重建或重新上传组件。JSON模式仅在结束时向stdout输出一个对象，读取进度写stderr。

`wait.state`明确区分`ready`、`failed`、`action_required`、`timed_out`、`cancelled`、`unconfirmed`；对应退出码为0、1、2、3、130、2（SIGTERM为143）。只有原构建成功、预览ready且已镜像receipt的组件身份与三个hash一致时，才新增顶层`componentRef`作为可用锁定引用。原`build.receipt`仍是观察事实，单有receipt或`succeeded`不保证可用，也不表示公开上架。超时、丢失读取或需要人工处理时，保留原buildId查看，不要重复上传。

平台提供的作者诊断在JSON和人读模式保留stage、相对文件/行列、修复建议及有界编译摘录；权限拒绝不会触发另一条写入路径。

## 工作区开发连接

带有 `promptframe-workspace.json` 的工程使用一个本机服务连接 Studio：

```bash
promptframe dev . --studio-origin https://your-studio.example
promptframe dev . --studio-origin https://your-studio.example --idle-timeout 30
promptframe dev . --studio-origin https://your-studio.example --replace
promptframe dev stop .
```

仅已接入 Creation MCP、且持有当前作品编辑权的 Agent，才可以通过 MCP 自助配置 Studio 开发连接。Creation MCP 首次接入仍由人在 Studio 生成创作 Token，再向本机 Creation `connect` 提供；已有有效安全凭据可以复用。开发连接配对不替代首次授权，也不获取作品编辑权。

主路径先调用 `studio_preview` 的 `read`，确认当前作品在线页的准确 `pageId`、版本和已生效来源。再让本机 CLI 持续运行，把普通标准输出写入桥所在机器、仅本人可读的临时文件，例如 POSIX：

```bash
umask 077
connectionFile="$(mktemp "${TMPDIR:-/tmp}/promptframe-dev.XXXXXX")"
promptframe dev . --studio-origin https://your-studio.example > "$connectionFile" &
```

让 Agent 把这个文件的绝对路径作为 `connectionFile`，连同所选 `pageId` 和 `expectedVersion` 传给 `studio_preview(action="connect_development")`。Creation 桥在本机私密读取，不把连接凭据放进聊天、代码或 Git；不使用 `dev --json`，它仅在 `--dry-run` 时支持。命令受理后继续 `studio_preview.read`，分别核实际连接、构建接收和 Player 加载状态。文件由本机作者在不再需要配对时清理；停止服务用 `promptframe dev stop .`，不要凭 PID 猜测其他实例。

没有这条 MCP 路径时，手工将启动 JSON 粘贴到 Studio 开发连接面板是备用方式，勿发送到聊天。仅支持原 localhost 模式；CLI 开发服务须与 Studio 浏览器在同一主机。服务运行期间没有固定十分钟截止；无推送客户端且无请求持续30分钟后正常退出，`--idle-timeout 0` 可关闭闲置退出，推送心跳默认25秒。普通单组件 Vite 预览保持5173入口。

工作区默认端口为24000—24999，冲突时在段内选并记住可用端口，`--port` 优先。`.promptframe/dev/` 只保存本机连接ID、端口和实例锁并自行忽略Git，不保存连接凭据。服务重启会更换凭据，应重新输出私有文件、读取在线页与新版本并重新配对；稳定连接ID不代表旧凭据可继续使用。普通页面刷新后先重读实际页面和连接状态，需要时再校验或配对，不把旧页ID和版本用于新页面。

关闭开发面板不停止连接；切换账号、作品或关闭页面会断开。浏览器对本地网络访问的许可仍单独处理；需要原生采帧时的标签页共享授权也独立，开发连接成功不表示已允许采帧，刷新不会恢复旧共享流。停止或替换仅操作本工作区的实际实例，无法确认退出时保留准确错误，不强制终止。

上传组件后，用准确的正式 `componentRef` 替换作品节点引用并移除该节点的 `componentSource`。仅上传成功不会自动改变作品的选源。确认作品已使用正式引用且不再需要本地预览后，可执行 `promptframe dev stop .`。

## 素材引用槽与本地私有预览

在 schema 中用 `promptFrameResourceSchema` 声明素材参数，在组件中用 `promptFrameResource` 消费。参数保存 public 路径或 `asset-proxy://` 引用；组件不读取凭据，也不调用平台解析接口。

```ts
import { z } from 'zod';
import { promptFrameResourceSchema } from '@promptframe/contracts';
export const propsSchema = z.object({
  illustration: promptFrameResourceSchema({
    kinds: ['image'], sources: ['public', 'asset'],
    accept: ['image/png', 'image/jpeg'], maxFileBytes: 16 * 1024 * 1024,
  }).describe('展示图片').default('/example.png'),
});
```

组件使用 `<Img src={promptFrameResource(props, props.illustration)} />`。本地、Studio 预览和正式渲染使用同一写法；解析由宿主完成。正式渲染缺失、错误类型或越权引用会报错，不自动替换作品内容。

新模板已启用 Vite 适配器。自定义旧项目在 `vite.config.ts` 的 plugins 中加入 `promptFramePreviewResources()`（从 `@promptframe/cli/preview` 导入），再运行 `promptframe sync . --apply` 更新预览壳；已有 React 插件等设置继续保留。适配器仅在本机 loopback 开发服务中运行，不导入组件业务代码。

```bash
promptframe resource set . --prop /illustration --file ./my-selected.png
promptframe resource status .
promptframe resource clear .
```

本人明确选择的 PNG、JPEG、WebP 或自包含 GLB 文件最大 16MiB，并受槽声明的种类、MIME 和大小限制。图片不能选入仅模型槽，模型也不能选入仅图片槽。CLI 记录原文件身份和 SHA，不复制原件；每次读取重新核对。选择存入 ignored 的 `.promptframe/local-previews/resources.json`，不会改公开 `preview-props.json`，打包固定排除此目录。选择最多 16 项，24 小时后不再提供读取；`resource clear` 只移除受管选择记录，不删除原始文件。没有后台清理进程。

已有目标镜头和授权连接时，从 `studio_preview` 读取所选节点的 `fileTarget` 和连接的 `studioSlotFiles`。支持该能力的页面可配合 CLI 0.1.89 使用 `promptframe resource set <连接根目录> --studio-slot <fileTarget> --file <GLB> --watch`。只有模型文件时，可从空目录运行 `promptframe dev . --resources-only --studio-origin "$STUDIO_ORIGIN"`。选文件、绑定、按摘要采帧及清除的完整步骤见[当前镜头试模型](https://github.com/ty-teams/promptframe-component-authoring/tree/main/examples/director-revisions#在当前镜头直接试模型)。

```bash
promptframe resource set ./components/model-shot --prop /model --file ./selected.glb --watch
promptframe dev . --studio-origin https://studio.example
```

监听复用当前工作区开发连接，仅观察明确选定的路径，不因文件更新延长原24小时期限。导演在已有授权的开发连接上读取目标 Studio 页面当前版本、已声明的模型槽以及本机模型标识。通过 studio_preview 的 bind_model_resource 将对应摘要绑定到该页的具体节点和槽位，读回实际采用状态，再用当前页共享采帧检查画面。clear_model_resource 可清除该绑定。文件路径仅在本机使用。有效改动经自包含、大小及摘要校验后替换预览；坏更新显示原因并保留上一份已验证模型，清除或断开后恢复作品已采用素材。仅有活跃观察者时做有界补查以覆盖合并的文件事件；开发服务关闭即停止，未变化的文件不重新编译组件。普通 Vite 单组件预览仍按一次选定的文件快照读取，不把浏览器手选 File 当成持久磁盘监听。

平台素材使用同一选择命令的 `--asset-ref` 和原作品 `--session-id`，不得与 `--file` 同用。项目来自正常 `promptframe init` 写入的无凭据上下文。需要先沿正常 `promptframe login --endpoint <平台API> --with-assets` 授予 `asset.read`；旧组件上传凭据不会自动扩大权限。开发服务复用现有 CLI 凭据，逐次请求当前用户、项目与作品范围内的短时只读表示，核字节 SHA 后向浏览器提供本机地址。凭据、签名 URL 和私有文件路径不会发送给组件。断网、撤权、文件变化或选择过期时，预览明确提示不可用并标明正在展示包内示例；恢复条件后刷新。

市场预览的素材选择读取访问者当前作品中的就绪素材，不改变组件包或上传新素材。正式使用时将合法素材引用冻结在 Spec，渲染入口沿原授权、素材存储和预下载合同准备本地表示；签名 URL 不保存到 Spec。

工作区 dev 与 package 共用模块目录及子目录的 `.gitignore` 选择语义，不隐式读取工作区祖先的 ignore 规则；新增且未提交的合法源码仍会捕获。忽略的出图不读入快照或使已检查模块失效，必要入口、原始锁文件和 public 资源被误排时明确报错。dev 保留原始锁和工作区声明，正式源码包继续生成原锁证据；两者不是同一种字节格式。

### 开发临时目录

本地编译与校验把进程归属记录放在临时输入目录之外，正常完成后回收输入。后续编译只回收归属可核、生产进程已退出的遗留目录；活动目录、缺失或不明的记录继续保留，不按名称或文件时间批量删除。Linux 还检查原编译进程组的后代，确认其退出后再回收；其它宿主缺少相应退出证明时保留异常目录。此回收不修改组件项目、连接状态或浏览器模块内存。

### 带原声复看指定帧段

从作品的 `read_timeline` 取得目标镜头和起始帧。开发时可用作者工程已安装的 Remotion CLI 渲染所选组合的局部区间。完成导出后，也可从本人可读取的恒帧率成片（需要 FFmpeg 和 ffprobe）裁出相同帧段。每次只生成一个本地 MP4。对照两版时使用同一起始帧、帧数和各自的输出名。若前面的镜头时长有变化，按各版场景起点换算同一个镜头内帧。

```sh
promptframe review-clip --entry src/video.tsx --composition Film --props shot.json --from-frame 120 --frames 90 --output after.mp4
promptframe review-clip --video before-export.mp4 --from-frame 120 --frames 90 --output before.mp4
```

`status --wait --json` 就绪时的顶层 `componentRef` 用于写入作品；项目私有构建使用 `project_private`。制品回执保留构建时的身份与各项摘要。
