# __DISPLAY_NAME__

PromptFrame 标准视频组件模板。

## AI-first 作者边界

默认协作方式是：人类用户负责审美判断和业务取舍，CodingAI 负责把 brief、用户素材、PromptFrame public authoring skill、平台 standard API 和 CLI diagnostic 落成可复用组件。

本模板默认面向 `marketplace_authoring`：组件要有清晰 props、可复用数据结构、响应式布局、安全默认值和严格上传准入。如果只是当前项目临时私有组件，应走平台的 `project_private_generation` lane，不要把一次性私有组件伪装成 marketplace-ready。

CodingAI 不能读取 PromptFrame 平台源码、内部协作看板、REQ/TASK/QA、内部协作收件箱、secret、内部部署脚本或私有 endpoint 默认值。

版本事实：Current npm registry baseline is `@promptframe/cli@0.1.28`, `@promptframe/contracts@0.1.13`, `@promptframe/component-kit@0.1.11`, and `create-promptframe-component@0.1.17`. The published CLI consumes the contracts AST-aware public security policy evaluator and reports `securityPolicyDigest` / `securityEvaluatorMode` / `publicResources` in JSON output.

## 本地开发

从零创建同款模板时，用当前公开 scaffold：

```bash
npx -y create-promptframe-component@latest ./my-component --name my-component --display-name "My Component"
cd my-component
```

```bash
npm install
# pnpm workspace users: pnpm install --ignore-workspace
npm run validate
```

如果你是冷启动 AI，先不要发散改目录结构。请按下面顺序做：

```bash
npx promptframe standard
npx promptframe doctor .
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe login --endpoint <promptframe-api-base>
npx promptframe whoami
npx promptframe upload . --endpoint <promptframe-api-base>
npx promptframe status <buildId> --endpoint <promptframe-api-base>
```

`promptframe login --endpoint <promptframe-api-base>` 会打开浏览器授权码登录；如果平台已经给了 scoped token，也可以用 `promptframe login --endpoint <promptframe-api-base> --token <token>` 验证并保存。不要手填 `tenantId` / `userId` / `projectId`，正式平台会从浏览器登录或 token 推导身份和项目；用 `promptframe whoami` 查看当前身份和 scope。`marketplace_authoring` 是默认外部作者 lane，`project_private_generation` 只用于项目内私有生成；token 可能只能上传到指定 lane。

如果上传入口不可用，仍然要完成本地 `dev` 预览、`validate` 和 `preview` envelope 检查，然后按组件作者报告模板写清本地结果。

## 必需文件

- `src/Component.tsx`：确定性的 frame-driven React 组件。
- `src/schema.ts`：Zod props schema（参数 schema）和默认 props。
- `src/preview-props.json`：有边界的默认预览参数。
- `manifest.json`：组件身份、版本、分类、审核状态和 hash 信息。

## 时间轴规则

- 所有动画必须由 `useCurrentFrame()` / `useVideoConfig()` 驱动。
- `manifest.json` 的 `designedDurationRange` 表示舒服播放区间，不是硬编码场景时长。
- 组件要能适配不同 `durationFrames`：时间不足时加速关键动作，时间富裕时保持最终态。
- 禁止 CSS `transition`、`@keyframes`、计时器、`Date.now()`、`Math.random()`。

项目级规则见 PromptFrame authoring skill 的 `rules/timing-ssot.md`。

## 风格协议

风格意图应来自 `@promptframe/contracts` 的公共合同，并通过 `@promptframe/component-kit/style` helper 解析。不要给单个组件发明私有 `color` / `theme` / `style` props；如果必须暴露风格控制，优先复用 shared style intent，或者把视觉选择保持为组件内部确定性默认值。

## 检索元数据

组件作者可以维护标题、摘要、描述、标签和参数说明。平台会根据源码、schema、依赖、预览画面和渲染结果生成不可手改的证据层，用于防止描述和真实能力不一致。

如果描述写得夸张但源码/预览证据不支持，组件不会一定被拦截，但会收到提示并影响公开市场排序。

动态数据组件可以参考 PromptFrame authoring skill 的 `rules/schema-recipes.md`，里面有增长指标、对比指标、漏斗阶段和正负 delta 的推荐 schema 写法。

本地视频预览、校验和 preview envelope 检查通过后，使用 `@promptframe/cli` 上传。

## 安全策略

安全规则来自平台标准 API。CLI 本地 `promptframe validate . --json` / `promptframe check . --json` 和服务端准入会使用同一套公开 ruleId 口径；机器读取时看 `checkedRuleIds`、`diagnostic.code`、`failureReason` 和 `retryable`。依赖版本过旧时先跑 `promptframe upgrade . --dry-run --json` 查看需要更新的 PromptFrame 包。

- 不要使用 `eval`、`new Function`、字符串定时器、`node:fs`、`child_process`、`process.env`。
- `runtime.deterministic.fps_hardcoded_timing` 是 warning-first（先警告）规则；看到它时把硬编码帧数改成 `secondsToFrames(seconds, fps)` 或 `createDurationTimeline()` / `timeline.at()`。
- 不要直接使用 `fetch()` / XHR / WebSocket / Beacon。
- 即使使用 `componentRuntime.fetchJson()`，也必须等待平台提供白名单配置；未配置时会进入 `manual_review`。
- 不要读取 `localStorage` / `sessionStorage` / cookie。当前可能只是 warning，但不建议保留。
- 需要小型随组件分发的图片、音频、视频、字体、JSON 或文本时，放在 `public/`，并用 `promptFramePublicResource(props, '/sample-data.json', fallback)` 读取平台注入的 runtime URL。CLI 会在 `validate/check/package/upload --json` 里报告 `publicResources`；平台 build admission（构建准入）接受后会给 preview/render 注入平台托管 URL，`status` / build 诊断仍是已接收文件、托管 URL 和拒绝原因的最终依据。不要绕过平台去写裸外部 URL 或组件侧 `fetch()`。

## 上传与状态

本地 `promptframe dev .` 会启动 Vite 预览壳，并在浏览器里渲染 `src/preview-props.json`。`preview` envelope 检查读取同一个文件，确认预览尺寸、帧率、时长和 props 边界。它们不运行自定义 runtime，也不能替代平台 iframe preview / probe / render evidence。

本地预览壳使用 `@remotion/player`，并传入 `acknowledgeRemotionLicense` 来减少本地开发时的重复提示；这不改变平台验收结论，也不是法律建议。作者仍应按自己的用途确认 Remotion license（Remotion 许可证）是否满足分发和商业使用要求。

预览壳右侧可以临时调整 props、切换画幅，并点击 `Export case` 导出当前本地预览 JSON。它还会通过 `@promptframe/component-kit/preview` 自动生成一组 bounded preview cases，包括 16:9、9:16、1:1 和基于默认 props 的文本/数字/布尔边界样本；这些样本仍会经过 `propsSchema.safeParse`，不会绕过 schema。建议把导出的文件保存到 `.promptframe/local-previews/<name>.json`，用于作者本地回归；然后运行 `promptframe preview . --write-local-report --json` 生成 `.promptframe/local-previews/preview-report.json`，记录 canonical preview 与本地 saved cases 的 hash。该目录只作为本地草稿，不进入上传 source package，平台验收仍以 `src/preview-props.json`、schema 和服务端 admission 结果为准。

```bash
npx promptframe dev .
npx promptframe check . --json
npx promptframe preview . --json
npx promptframe preview . --write-local-report --json
```

推荐直接上传组件目录：

```bash
npx promptframe upload . --endpoint <promptframe-api-base>
```

`upload .` 是推荐的一步式入口，会自动完成 validate、package 和上传。`package` 只用于离线传输或排查 zip 内容。

如果平台入口不可用，先保留本地校验结果和错误输出，不要把服务地址写进源码、manifest 或组件 README。

## GitHub CI

模板已包含 `.github/workflows/promptframe-component.yml`。PR 会运行 `promptframe check . --json` 并把诊断写成 GitHub annotations / summary；`main` 和 release tag push 才会运行 `promptframe upload .`。

在 GitHub repository settings 中配置：

- Secret: `PROMPTFRAME_CI_TOKEN`
- Variable: `PROMPTFRAME_API_BASE`

不要把 token 或私有平台域名写进 workflow、README、源码或 issue。需要重新生成 workflow 时可运行：

```bash
npx promptframe setup-ci --provider github --force
```

CodingAI 排查失败时优先看 CLI JSON diagnostics、GitHub Check annotations、Action summary、artifact report 和平台 `status` / admission diagnostics。不要读取 `remotion-media` 内部 REQ/TASK/QA、agent board、部署脚本或私有 endpoint；身份由浏览器登录或 `PROMPTFRAME_CI_TOKEN` 代表，不靠手填 `userId` / `tenantId` / `projectId`。

第三方组件不是完整浏览器扩展环境。不要默认使用跨标签通信、Service Worker、WebRTC、Notification、剪贴板、裸网络请求、动态 import、危险 HTML 或长时间 observer；优先改成 props、平台 asset 或受控平台 API。CLI / GitHub PR check 会尽量提前提示，平台 upload admission、preview runtime 和 render sandbox 仍是最终门禁。

查看构建验收状态：

```bash
npx promptframe status <buildId> --endpoint <promptframe-api-base>
```

上传成功只代表服务端已接收源码并执行构建验收，不等于组件已经公开发布。

如果平台提示预览资产是平台环境问题，平台维护者修复后可重新生成预览：

```bash
npx promptframe reindex <buildId> --endpoint <promptframe-api-base>
```

## 组件包边界

本组件目录是上传、构建和验收边界。源码文件可以引用组件目录内部文件，但不能引用组件目录外的本地文件，也不要依赖本地 path alias。需要复用的公共能力应来自 npm 包或平台标准包，例如 `@promptframe/component-kit`。
