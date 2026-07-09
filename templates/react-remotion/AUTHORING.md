# PromptFrame Authoring Guide

本文是当前组件项目的恢复入口。业务代码属于作者：`src/Component.tsx`、`src/schema.ts`、`manifest.json`、`public/` 不会被 `promptframe sync` 静默覆盖。平台生成的本地预览壳可以随工具链升级刷新。

## Preview Shell

`src/PreviewRoot.tsx` 是 thin shell（薄入口）：它导入 `PromptFramePreviewApp`，注入组件、schema、`preview-props.json` 和 `promptFrameDevPublicResources`。通用的 reset、locale（语言）、resource slot（资源槽）、Inspector 布局和 Remotion Player 装配都在 `@promptframe/component-kit/preview-react`。

刷新本地预览壳：

```bash
promptframe sync . --apply
```

## Reset And Locale

本地预览 reset 会恢复完整 preview state：props、尺寸、fps、duration、case name 和 locale 都回到初始快照。

中文预览可使用 `?locale=zh`，英文预览可使用 `?locale=en`。

## Resource Slot

只有 schema metadata 明确声明 `promptFrameResource` 或 `xPromptFrameResource` 的字段才会显示 public resource picker。普通标题、摘要、说明文案不会因为类型是 `string` 就出现资源按钮。

组件运行时使用 `promptFramePublicResource(props, '/sample.png', fallback)` 把 publicPath 解析成可渲染资源 URL。

## Freshness

常用恢复命令：

```bash
pnpm add @promptframe/contracts@latest @promptframe/component-kit@latest
pnpm add -D @promptframe/cli@latest create-promptframe-component@latest
promptframe sync . --apply
promptframe check .
```

`minPackageVersions` 是最低门槛，`recommendedAuthoringPackages` 是当前 standard hash 推荐版本。遇到 `standard.freshness.*` 或 `scaffold.template.stale` 时，优先按 CLI 输出的命令升级，然后重新执行 `promptframe sync . --apply`。

