# __DISPLAY_NAME__

平台标准 Remotion 组件市场组件。

## 本地开发

```bash
npm install
npm run validate
```

如果你是冷启动 AI，先不要发散改目录结构。请按下面顺序做：

```bash
npx promptframe standard
npx promptframe doctor .
npx promptframe validate .
npx promptframe upload . --endpoint <promptframe-api-base>
npx promptframe status <jobId> --endpoint <promptframe-api-base>
```

如果上传入口不可用，仍然要完成本地开发和 `validate`，然后按组件作者报告模板写清本地结果。

## 必需文件

- `src/Component.tsx`：确定性的 Remotion 组件。
- `src/schema.ts`：Zod props schema（参数 schema）和默认 props。
- `src/preview-props.json`：有边界的默认预览参数。
- `manifest.json`：组件身份、版本、分类、审核状态和 hash 信息。

## 时间轴规则

- 所有动画必须由 `useCurrentFrame()` / `useVideoConfig()` 驱动。
- `manifest.json` 的 `designedDurationRange` 表示舒服播放区间，不是硬编码场景时长。
- 组件要能适配不同 `durationFrames`：时间不足时加速关键动作，时间富裕时保持最终态。
- 禁止 CSS `transition`、`@keyframes`、计时器、`Date.now()`、`Math.random()`。

项目级规则见 PromptFrame authoring skill 的 `rules/timing-ssot.md`。

## 检索元数据

组件作者可以维护标题、摘要、描述、标签和参数说明。平台会根据源码、schema、依赖、预览画面和渲染结果生成不可手改的证据层，用于防止描述和真实能力不一致。

如果描述写得夸张但源码/预览证据不支持，组件不会一定被拦截，但会收到提示并影响公开市场排序。

动态数据组件可以参考 PromptFrame authoring skill 的 `rules/schema-recipes.md`，里面有增长指标、对比指标、漏斗阶段和正负 delta 的推荐 schema 写法。

本地校验通过后，使用 `@promptframe/cli` 上传。

## 安全策略

安全规则来自平台标准 API。CLI 本地 `promptframe validate . --json` 和服务端准入会使用同一套公开 ruleId 口径；机器读取时看 `checkedRuleIds`、`diagnostic.code`、`failureReason` 和 `retryable`。

- 不要使用 `eval`、`new Function`、字符串定时器、`node:fs`、`child_process`、`process.env`。
- 不要直接使用 `fetch()` / XHR / WebSocket / Beacon。
- 即使使用 `componentRuntime.fetchJson()`，也必须等待平台提供白名单配置；未配置时会进入 `manual_review`。
- 不要读取 `localStorage` / `sessionStorage` / cookie。当前可能只是 warning，但不建议保留。
- 需要素材、状态或外部数据时，让平台通过 props / asset / 后续受控 wrapper 注入。

## 上传与状态

推荐直接上传组件目录：

```bash
npx promptframe upload . --endpoint <promptframe-api-base>
```

`upload .` 是推荐的一步式入口，会自动完成 validate、package 和上传。`package` 只用于离线传输或排查 zip 内容。

如果平台入口不可用，先保留本地校验结果和错误输出，不要把服务地址写进源码、manifest 或组件 README。

查看构建验收状态：

```bash
npx promptframe status <jobId> --endpoint <promptframe-api-base>
```

上传成功只代表服务端已接收源码并执行构建验收，不等于组件已经公开发布。

如果平台提示预览资产是平台环境问题，平台维护者修复后可重新生成预览：

```bash
npx promptframe reindex <jobId> --endpoint <promptframe-api-base>
```

## 组件包边界

本组件目录是上传、构建和验收边界。源码文件可以引用组件目录内部文件，但不能引用组件目录外的本地文件，也不要依赖本地 path alias。需要复用的公共能力应来自 npm 包或平台标准包，例如 `@promptframe/component-kit`。
