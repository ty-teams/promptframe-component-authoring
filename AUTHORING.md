# PromptFrame Authoring Guide

本文是外部组件作者的单页恢复入口。组件项目应把业务代码留在 `src/Component.tsx`、`src/schema.ts`、`manifest.json`、`public/` 等作者文件里，把本地预览壳交给 `@promptframe/component-kit` 和 `promptframe sync` 维护。

<a id="authoring-decisions"></a>
## 作者决策表

在作者工程里运行下面两条命令。第一条列出本工程安装的包版本，第二条给出实际运行的 CLI 随包携带的发行标识 `authoringStandardRelease.releaseId`。在仓库的标签选择器打开这个标识，再读同一路径的手册。例如 CLI 0.1.89 对应 [authoring-release-2026-11-21.1 的手册](https://github.com/ty-teams/promptframe-component-authoring/blob/authoring-release-2026-11-21.1/AUTHORING.md#authoring-decisions)。

```bash
npm ls --depth=0 @promptframe/cli @promptframe/component-kit @promptframe/contracts
npx --no-install promptframe standard --json
```

Studio 的项目入门和 MCP 的 `platform_read_onboarding` 提供平台已采用的作者工具组合及四个固定文档入口，见 `navigation.componentAuthoring.release`。创作基线的版本属于导演指引。需要上传时，用当前项目的 `promptframe check . --endpoint "$PROMPTFRAME_API_BASE" --json` 对照平台标准和最低依赖；使用可选功能时再核对本机命令帮助与目标页面、平台实际返回的能力。这样可以同时使用较新的本机工具和平台已经支持的功能。

| 需要 | 采用方式 | 边界与当前支持 |
| --- | --- | --- |
| 独立组件 | 组件根放 `manifest.json`、`package.json`、`src/` 和可选的 `public/` | 在组件根运行 `check/package/upload .`。同一 Git 仓里有其它组件，也可逐个从各自目录操作 |
| 同仓共享本地源码 | 工作区清单显式声明 `sharedDirectories`，从根选择 `--workspace-component` | 捕获选中组件及实际引用的共享 JS/TS/JSON/文本闭包，保留真实根相对路径；不纳入未引用组件或共享文件 |
| 跨仓公共库 | 使用允许的精确 npm 版本并保留依赖锁证据 | 不自动内联 `workspace:*`、`file:`、宿主 `node_modules` 或任意 path alias；运行依赖仍须原准入 |
| 手动上传 | 在目标项目 `check`，上传目录或先 `package` 再上传原 ZIP，用 `status <buildId> --wait --json` 读回锁定引用 | 普通上传默认项目私有。使用共享布局的包时平台须声明 `sourcePackageLayouts` 支持 `promptframe-component-source-layout/v1`。申请公开沿同一构建执行 `public-request` |
| GitHub Actions 上传 | 在 Git 根运行 `promptframe setup-ci . --provider github`，清单工作区加 `--workspace` | 提交根 `.github/workflows/` 中生成的工作流后才启用。仅在组件子目录放模板不会触发整仓 CI。PR 运行检查，推送按工作流调用同一条 CLI 上传命令。CI Token 只提供相应项目与范围的权限 |
| 从历史版本恢复 | 在自己的构建详情下载源码，或让已授权的导演读取指定的历史构建 | 用构建号定位，按该版本的 ZIP 和包内目录恢复。具体操作见下方的历史源码步骤 |
| 依赖恢复 | 原 Git 历史和安全的原锁文件优先；归档只含脱敏锁证据 | 证据绑定 package.json 和锁摘要，不是可执行锁文件；不得把 `.npmrc`、凭据或原始锁文件发布进源包 |
| 本地与正式预览 | 共用上述捕获输入及原 public/素材槽 | dev 输入上限仍 16MiB，正式源包仍 50MiB；CSS Modules 继续沿原限制，不支持 CSS import/URL 或全局样式 |

例如同仓有三个组件，A、B 都引用同一套主题，C 有自己的样式。可用以下清单声明共享边界。

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
npx --no-install promptframe workspace validate . --json
npx --no-install promptframe check . --workspace-component @demo/part-a --json
npx --no-install promptframe package . --workspace-component @demo/part-a --out ./part-a.zip --json
```

在有清单的工作区根，`upload .` 会依次上传所有已登记组件，每个组件有独立构建号。只交付 A 时，上传也用同一个 `--workspace-component @demo/part-a`，或上传刚生成的 `part-a.zip`。A 引用共享文件时要从工作区根选择 A。进 A 的子目录按普通单组件打包，只能使用该组件根内的源码。小型随包资源放在该组件的 `public/`，作品私有素材通过已声明的素材槽传入。试改代码、对照两版 GLB 或跟原声改节奏，可运行[三个改稿示例](examples/director-revisions/README.md)。

从已选账号的创作会话上传时，可把其已验证身份交给兼容的 CLI，使浏览器批准与文件发送均绑定这次选择。见[指定账号的登录与上传](packages/cli/README.md#target-account)。

<a id="restore-source"></a>
### 找回已上传的那一版源码

1. 先确定平台、项目和目标组件。网页端在「我的组件」的构建详情核对版本与构建号，有下载权限时点「下载此版本源码」。MCP 端在原项目有权作品上调用 `platform_read_component_source`，传 `action: "list"`、`projectId`、`sessionId`、`componentId`。结果最多列出本人在该项目提交的 100 个构建，含实际版本、构建号、归档记录与摘要。
2. 选中对应的 `buildId`，在同一项目和作品调用该工具，传 `action: "download"` 和构建号。返回 ZIP 的 `sha256`、字节数、到期时间和两分钟有效的下载入口。下载时仍会核对授权。用返回的大小和归档摘要核对文件；链接到期时为同一构建重新申请。有权使用成品的作者，仍需具备该源包的读取权限。
3. 每份 ZIP 解到各自的新空目录。普通包在组件根恢复；共享布局保留 `promptframe-source-layout.json`、清单及包内相对路径，从解压根运行已安装的 `promptframe validate . --json`。还原当时的依赖安装环境时回到原 Git 版本找锁文件，包内脱敏锁证据只供核对。若来源已回收或无权下载，可从自己保存的原 ZIP 或 Git 版本继续。

只想观察构建是否就绪时，用 `status <buildId> --wait --json` 即可。首次回执中断时，先从本人的构建记录查原单；支持按摘要查找的 CLI 还可按原 ZIP 查询。见[构建查询的版本说明](packages/cli/README.md#build-status)。

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

反复改一镜、换本机模型或跟旁白调切点时，可按需查看[三个可运行的改稿示例](examples/director-revisions/README.md)，内含脚手架、输入素材、前后画面和判断依据。

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

模型已能绘制，但关键贴图或其它视觉处理仍需异步完成时，使用同一入口的 `usePromptFramePreparation`（component-kit 0.1.43 起）。在组件中无条件调用该 hook，在占位画面可能绘制前登记；`identity=null` 表示该组件当前没有这项工作。`prepare` 返回已完成解码的值，组件在同次提交的同步 `useLayoutEffect` 中应用材质并绘制，SDK随后才解除有限渲染等待和播放缓冲。

```tsx
import { usePromptFramePreparation } from '@promptframe/component-kit/model-react';

// prepareTexture/disposeTexture 使用稳定函数。读取仍来自现有授权资源。
const texture = usePromptFramePreparation(model ? textureVersion : null, {
  prepare: prepareTexture,
  dispose: disposeTexture,
});
useLayoutEffect(() => {
  if (!model) return;
  applyMaterial(model, texture); // texture为null时可以绘制占位，但不能交就绪回执。
  renderer.render(scene, camera);
}, [model, texture, frame]);
```

`identity`和稳定回调必须随资源、模型/内容版本变化；若异步结果依赖帧，也须包含该帧。多个节点分别拥有自己的准备任务，不共享可变材质。退场、`identity=null`、换代或卸载会取消旧任务；异步代码每次await后先检查signal，不将旧值写到新画面。SDK释放未采用的晚到结果，每项总预算15秒，失败只返回`visual.preparation_timeout/cancelled/failed`，不会把异常中的URL或其它自由文本作为公开原因。组件仍负责关闭其ImageBitmap和释放geometry/material/texture。

保证范围是已登记的关键工作，以及结果提交中的同步layout绘制。稍后才启动的未登记Promise、useEffect或requestAnimationFrame中的绘制不能据此视为完成；应将准备纳入hook，并在其结果提交的同步layout阶段完成实际绘制。不要用固定sleep、背景颜色、一次DOM提交或全网空闲代替准备。下一镜应在它实际挂载或需要内容时登记，不要让不属于当前画面的任务阻塞当前帧。该能力不增加网络权限、延长素材授权或改变原捕获期限。

CLI本地选择支持GLB，`resource clear` 仍只清选择记录；已有项目用兼容CLI执行 `sync . --apply` 更新开发壳。包内public与已授权作品引用使用同一个读取、准备接口，不开放任意fetch。

## 包版本与发行组合

contracts中已有的发行常量是该包附带的离线基线，不是实时的推荐版本。仓库根的 `authoring-release.json`描述本次源码目标组合；CLI包内同名文件保留该CLI发行时的离线基线，平台以其已验证的完整组合给出当前推荐。两者不要求永远相同，不为其它包升级而重发CLI。包按实际接口、生成代码和依赖分别升级；未变化且兼容的已公开精确版本可复用。发行只打包和发布本次显式选择的包，继续保留每个版本的唯一字节、OIDC身份与registry核回。发布等待按实际依赖图进行，不能仅因另一个包属于同一仓库就增加等待。

CLI按自身运行依赖检查软件最低版本，按项目或上传归档的实际声明检查组件依赖最低版本，不用离线推荐的kit版本代替项目事实。已生成的较新scaffold不按旧CLI所知的模板摘要判过期；相同版本的摘要差异仍明确提示。
# 旁白驱动的帧参数

需要随旁白词句移动的动作，可在 `manifest.actionSlots` 显式声明数值型 props：

```json
{"actionSlots":[{"name":"emphasize","description":"开始强调的节点局部帧","propPath":["emphasisFrame"],"unit":"frame","timeBase":"node"}]}
```

`emphasisFrame` 必须在 props schema 中声明为 `number` 或 `integer`，并提供当前有效值；支持有界的嵌套对象和数组路径。组件照常根据收到的局部帧参数绘制，不自行读取音频或修改时间线。动作槽不会改变组件时长或内部阶段映射。未声明的参数不能由旁白绑定写入。

## 可选展示预设

`src/preview-props.json` 是默认展示。即使没有额外展示预设，CLI 也会按组件声明检查默认预览的必填参数、类型和取值；已有合法默认值的参数可以省略。可增加 `src/showcase.json`，为默认组指定采样帧，并添加最多两个参数预设；脚手架的 `examples/showcase.json` 提供可复制的例子。未提供此文件的组件保持默认组。

```json
{"defaultFrames":[0,24,48,71,95,119],"presets":[{"id":"faster","label":"数字提前到位","propsOverride":{"countDuration":18}}]}
```

示例帧号对应120帧预览，参数名应替换为组件实际声明的字段。对象逐字段合并、数组整体替换，再校验完整参数。省略帧列时自动均匀选择最多六个不同的局部帧；手写帧列需要6–8个互异递增且未越界的时点，少于六帧的短片使用全部帧。

`promptframe check` 和 `package` 使用公共合同校验文件结构、已解析的 schema 字段及资源引用。组件自定义的运行期谓词仍在实际预览时执行。源码展示使用包内示例；私有素材和本机临试继续通过相应授权入口选择，不把临时读地址或凭据写入声明。
