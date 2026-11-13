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

本人明确选择的 PNG、JPEG、WebP 文件最大 16MiB，并受槽声明的 MIME/大小限制。CLI 记录原文件身份和 SHA，不复制原件；每次读取重新核对。选择存入 ignored 的 `.promptframe/local-previews/resources.json`，不会改公开 `preview-props.json`，打包固定排除此目录。选择最多 16 项，24 小时后不再提供读取；`resource clear` 只移除受管选择记录，不删除原始文件。没有后台清理进程。

平台素材使用同一选择命令的 `--asset-ref` 和原作品 `--session-id`，不得与 `--file` 同用。项目来自正常 `promptframe init` 写入的无凭据上下文。需要先沿正常 `promptframe login --endpoint <平台API> --with-assets` 授予 `asset.read`；旧组件上传凭据不会自动扩大权限。开发服务复用现有 CLI 凭据，逐次请求当前用户、项目与作品范围内的短时只读表示，核字节 SHA 后向浏览器提供本机地址。凭据、签名 URL 和私有文件路径不会发送给组件。断网、撤权、文件变化或选择过期时，预览明确提示不可用并标明正在展示包内示例；恢复条件后刷新。

市场预览的素材选择读取访问者当前作品中的就绪素材，不改变组件包或上传新素材。正式使用时将合法素材引用冻结在 Spec，渲染入口沿原授权、素材存储和预下载合同准备本地表示；签名 URL 不保存到 Spec。

## 布局、预览时长与运行依赖

CLI 按真实样式上下文检查布局：0、无单位行高和 SVG 坐标不属于固定像素布局。真实像素长度仍需通过 layout helper 缩放，诊断包含文件、行和列。

预览按 manifest.designedDurationRange.max 播放，范围单位为帧，按预览 fps 最多播放30秒。缺少范围的兼容读路径使用原预览帧数并保留同样上限；正式作品时长继续由作品决定。自定义旧预览壳需向 PromptFramePreviewApp 传 designedDurationRange，或运行 promptframe sync . --apply。

纯开发依赖不进入运行依赖目录审核。组件、schema 或 index 的运行导入及其本地闭包必须把第三方包声明在 dependencies、peerDependencies 或 optionalDependencies；不能仅放入 devDependencies。类型专用导入使用 import type；锁文件、隔离安装和安全检查继续生效。
