# PromptFrame Authoring Guide

本文是外部组件作者的单页恢复入口。组件项目应把业务代码留在 `src/Component.tsx`、`src/schema.ts`、`manifest.json`、`public/` 等作者文件里，把本地预览壳交给 `@promptframe/component-kit` 和 `promptframe sync` 维护。

## Preview Shell

新模板的 `src/PreviewRoot.tsx` 只是 thin shell（薄入口）：它导入 `PromptFramePreviewApp`，注入组件、schema、`preview-props.json` 和 `promptFrameDevPublicResources`。通用的 reset、locale（语言）、resource slot（资源槽）、Inspector 布局和 Remotion Player 装配都在 `@promptframe/component-kit/preview-react`。

旧项目如果还保留胖 `PreviewRoot.tsx`，执行：

```bash
promptframe sync . --apply
```

`sync` 只刷新 PromptFrame 生成的 authoring shell 文件，不应覆盖作者业务组件、schema、manifest 或 `public/` 资源。

## Reset And Locale

本地预览 reset 表示恢复完整 preview state：props、尺寸、fps、duration、case name 和 locale 都回到初始快照，不只是重置 props。

locale 由 URL / browser language 等公开输入解析。需要中文界面时，可在本地预览 URL 使用 `?locale=zh`；英文使用 `?locale=en`。

## Resource Slot

不要把普通 `text` 字段当资源选择器。只有 schema metadata 明确声明 `promptFrameResource` 或 `xPromptFrameResource` 的字段才会显示 public resource picker。

资源槽可以描述 `accept`、`kind` / `kinds` 和 `maxFileBytes`。示例：

```ts
backgroundImage: z.string().describe('Background image from public resources.').meta({
  promptFrameResource: {
    kinds: ['image'],
    accept: ['image/*'],
  },
})
```

组件运行时使用 `promptFramePublicResource(props, '/sample.png', fallback)` 把 publicPath 解析成可渲染资源 URL。

## Freshness

平台 standard 响应会同时提供：

- `minPackageVersions`：最低可接受版本，用于 admission / check 的硬门槛。
- `recommendedAuthoringPackages`：当前 standard hash 推荐安装版本，用于日常升级和排查版本漂移。

常用恢复命令：

```bash
pnpm add @promptframe/contracts@latest @promptframe/component-kit@latest
pnpm add -D @promptframe/cli@latest create-promptframe-component@latest
promptframe sync . --apply
promptframe check .
```

如果 CLI 报 `standard.freshness.platform_behind`，说明本地工具比平台部署更新；本地 dev/check 可以继续观察，upload 需要等平台 rollout 或使用平台广告的兼容版本。

