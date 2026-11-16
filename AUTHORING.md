# PromptFrame Authoring Guide

本文是外部组件作者的单页恢复入口。组件项目应把业务代码留在 `src/Component.tsx`、`src/schema.ts`、`manifest.json`、`public/` 等作者文件里，把本地预览壳交给 `@promptframe/component-kit` 和 `promptframe sync` 维护。

<a id="authoring-decisions"></a>
## 作者决策表

本节随工具链发行保存；使用固定版本时，从对应的 `authoring-release-*` tag 阅读本节。当前源码对应 contracts `0.1.46`、component-kit `0.1.40`、CLI `0.1.78`、scaffold `0.1.68`；公开版本和平台实际支持以 registry 与 `/components/standard` 为准。

| 需要 | 采用方式 | 边界与当前支持 |
| --- | --- | --- |
| 独立组件 | 组件根放 `manifest.json`、`package.json`、`src/`、`public/` | `check/package/upload .` 只读取此根，不因同 Git 仓而扩大边界 |
| 同仓共享本地源码 | 工作区清单显式声明 `sharedDirectories`，从根选择 `--workspace-component` | 捕获选中组件及实际引用的共享 JS/TS/JSON/文本闭包，保留真实根相对路径；不纳入未引用组件或共享文件 |
| 跨仓公共库 | 使用允许的精确 npm 版本并保留依赖锁证据 | 不自动内联 `workspace:*`、`file:`、宿主 `node_modules` 或任意 path alias；运行依赖仍须原准入 |
| 手动上传 | `check` → `package` → `upload` → `status --wait` | 平台须声明 `sourcePackageLayouts` 支持 `promptframe-component-source-layout/v1`，否则新格式在上传前拒绝 |
| CI 上传 | 原 `setup-ci --workspace` 矩阵及 upload CI Token | 组件选择来自清单和 manifest；Token 不选择组件，也不授予其它项目权限 |
| 从历史版本恢复 | 原作者在 Studio 的构建历史选版本并下载源码；MCP 使用 `platform_read_component_source` | 逐次核项目、作者、版本和归档；MCP 只返回版本摘要与短期下载入口，不把 ZIP 塞入模型上下文，不授编辑或发布权 |
| 依赖恢复 | 原 Git 历史和安全的原锁文件优先；归档只含脱敏锁证据 | 证据绑定 package.json 和锁摘要，不是可执行锁文件；不得把 `.npmrc`、凭据或原始锁文件发布进源包 |
| 本地与正式预览 | 共用上述捕获输入及原 public/素材槽 | dev 输入上限仍 16MiB，正式源包仍 50MiB；CSS Modules 继续沿原限制，不支持 CSS import/URL 或全局样式 |

显式共享工作区示例：

```json
{
  "schemaVersion": "promptframe-workspace.v0.1.0",
  "components": [
    {"id": "@demo/part-a", "path": "components/part-a"},
    {"id": "@demo/part-b", "path": "components/part-b"},
    {"id": "@demo/part-c", "path": "components/part-c"}
  ],
  "sharedDirectories": ["shared"]
}
```

组件根须互不嵌套，共享目录须与所有组件根分开。组件可从 `components/part-a/src/Component.tsx` 静态导入 `../../../shared/theme`。A/B 引用主题而 C 不引用时，修改主题只改变 A/B 的新包输入；旧固定源包不变。单组件内部合法的 `../` 引用不会仅因向上一级而拒绝，实际路径仍须在组件根内。

```bash
npx -y -p @promptframe/cli@0.1.78 promptframe check . --workspace-component @demo/part-a --json
npx -y -p @promptframe/cli@0.1.78 promptframe package . --workspace-component @demo/part-a --out ./part-a.zip --json
```

每个历史 ZIP 解压到独立的新空目录，保留 `promptframe-source-layout.json` 和包内路径，然后在恢复根运行 `promptframe validate . --json`。不要把不同版本的 `shared/` 合并，不自动写回 Git；缺归档或无源码读取权时保留明确失败，不重新上传或生成替代版本。

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

平台当前组件运行代次为 `runtime-2026.11`，构建、Studio 与正式渲染共用 React 19.2.5、Remotion 4.0.487 和 component-kit 0.1.41；服务端使用 Node 20.20.2、Linux x64。全部 `@remotion/*` 使用同一 Remotion 版本。新模板在 manifest 的 `runtimeGeneration` 声明此代次；历史 manifest 省略此字段仍可读取，不会自动改写旧版本。组件通过平台提供的依赖运行，不自行替换宿主 React 或 Remotion。完整版本合同可从 contracts 的 `PROMPTFRAME_COMPONENT_RUNTIME_GENERATION` 读取。

CLI 按真实样式上下文检查布局：0、无单位行高和 SVG 坐标不属于固定像素布局。真实像素长度仍需通过 layout helper 缩放，诊断包含文件、行和列。

预览按 manifest.designedDurationRange.max 播放，范围单位为帧，按预览 fps 最多播放30秒。缺少范围的兼容读路径使用原预览帧数并保留同样上限；正式作品时长继续由作品决定。自定义旧预览壳需向 PromptFramePreviewApp 传 designedDurationRange，或运行 promptframe sync . --apply。

纯开发依赖不进入运行依赖目录审核。组件、schema 或 index 的运行导入及其本地闭包必须把第三方包声明在 dependencies、peerDependencies 或 optionalDependencies；不能仅放入 devDependencies。类型专用导入使用 import type；锁文件、隔离安装和安全检查继续生效。

## 自包含 GLB 模型槽

模型使用 `model` 槽和 `model/gltf-binary`。包内 `public/*.glb` 沿原资源限制：单文件10MiB、总计50MiB、最多64项。作品模型复用现有素材的上传、权限、保留期与清理流程，模型二进制读取上限16MiB；槽的 `maxFileBytes` 可进一步收窄。无需修改素材引用为公开URL。

```ts
import { promptFrameResourceSchema } from '@promptframe/contracts';
import { readPromptFrameModel } from '@promptframe/component-kit';

const modelSlot = promptFrameResourceSchema({
  kinds: ['model'], sources: ['public', 'asset'],
  accept: ['model/gltf-binary'], maxFileBytes: 10485760,
});

// public 例子；宿主将它绑定到当前组件包的已核文件。
const publicBytes = await readPromptFrameModel(props, '/lens-assembly.glb', { signal });
// 作品例子；沿正常选择器取得同一作品内已授权、就绪的引用。
const assetBytes = await readPromptFrameModel(props, props.model, { signal });
```

资源槽选项使用内联静态字面量，便于打包时核对；大小字段使用计算后的整数字节数。

`readPromptFrameModel` 返回调用者拥有的 `ArrayBuffer`，交给正常审核依赖中的 `GLTFLoader.parseAsync(bytes, '')`。宿主在开发、Studio及worker中核对原绑定、大小、SHA和GLB结构；没有宿主绑定时返回 `model.reader_unavailable`，不会回退到任意fetch。公开组件的preview-props继续使用包内例子，私有素材选择存入原开发草稿。

当前支持glTF 2.0 GLB：缓冲和贴图须放进BIN块，JSON块最多2MiB。URI（含data URI）、独立解码器下载、稀疏accessor及循环节点均明确拒绝；请在导出时嵌入资源并展开相应数据。Three和GLTFLoader继续沿正常依赖声明与锁文件审核，reader不提供额外联网权限。

画面中的异步准备使用 `@promptframe/component-kit/model-react` 的 `usePromptFrameModel`。SDK统一持有有限的渲染等待和播放缓冲；组件无需调用渲染延迟API。二进制读取与解析共享15秒预算，失败明确返回安全原因，卸载、切版或切换引用会取消旧准备，晚到的模型只释放、不采用。单独调用低层 `readPromptFrameModel` 只保证字节读取，不表示画面已准备完成。

```tsx
import { usePromptFrameModel } from '@promptframe/component-kit/model-react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// prepare/dispose使用模块函数或useCallback，避免每帧重新创建准备任务。
async function prepareModel(bytes: ArrayBuffer, signal: AbortSignal) {
  signal.throwIfAborted();
  return (await new GLTFLoader().parseAsync(bytes, '')).scene;
}

function ModelScene(props: Props) {
  const model = usePromptFrameModel(props, props.model, {
    prepare: prepareModel, dispose: disposeModel,
  });
  // null仅表示仍在准备；准备成功后再把模型装入当前画面。
  return model ? <PreparedModel model={model} /> : null;
}
```

`disposeModel`由组件实现，释放其拥有的geometry、material、texture和ImageBitmap；SDK保证当前准备结果在取消或退场时调用一次。解析器不支持中途取消时，超时后仍不会采用其晚到结果，不能把超时当作解析器物理退出。首帧所需的异步解析和处理都放入 `prepare`，不要在其成功后另起未受控的加载。

CLI本地选择支持GLB，`resource clear` 仍只清选择记录；已有项目用兼容CLI执行 `sync . --apply` 更新开发壳。包内public与已授权作品引用使用同一个读取、准备接口，不开放任意fetch。

## 包版本与发行组合

contracts中已有的发行常量是该包附带的离线基线，不是实时的推荐版本。仓库根的 `authoring-release.json`描述本次源码目标组合；CLI包内同名文件保留该CLI发行时的离线基线，平台以其已验证的完整组合给出当前推荐。两者不要求永远相同，不为其它包升级而重发CLI。包按实际接口、生成代码和依赖分别升级；未变化且兼容的已公开精确版本可复用。发行只打包和发布本次显式选择的包，继续保留每个版本的唯一字节、OIDC身份与registry核回。发布等待按实际依赖图进行，不能仅因另一个包属于同一仓库就增加等待。

CLI按自身运行依赖检查软件最低版本，按项目或上传归档的实际声明检查组件依赖最低版本，不用离线推荐的kit版本代替项目事实。已生成的较新scaffold不按旧CLI所知的模板摘要判过期；相同版本的摘要差异仍明确提示。
