# @promptframe/contracts

Public contracts for PromptFrame component manifests, component references, diagnostics, layout capability cards, and public authoring policy metadata.

This package is intentionally small and safe to consume from authoring tools, templates, and platform integration code. It exports the public standard/security policy IDs used by `@promptframe/cli` so automation can rely on stable diagnostics without reading platform-internal docs.

Key public exports:

- `PROMPTFRAME_AUTHORING_STANDARD_RELEASE`: current authoring standard release metadata, source hash, minimum package floors, recommended authoring package versions, supported component types, and upload target policy.
- `layoutModeSchema` / `LayoutMode`: controlled layout-mode machine contract for `slot_fill_reflow`, `fixed_aspect_fit`, and `floating_ornament`; new strict authoring uploads must declare it inside `manifest.layout`.
- `authoringStandardFreshnessDecisionSchema`: shared shape for local tooling and platform admission to explain whether an authoring package is current, warning-only, upload-blocking, or security-breaking.
- `authoringUploadTargetSchema`: public upload lanes for `marketplace_authoring` and `project_private_generation`.
- `componentReusabilityScoreSchema`: shared shape for deterministic component reuse diagnostics emitted by local CLI checks and platform admission.
- `componentPublicResourceManifestSchema` and `componentRuntimeResourceManifestSchema`: public `public/` resource manifest and runtime URL shapes for component-bundled images, audio, video, fonts, JSON, and text.
- `PROMPTFRAME_PUBLIC_RESOURCE_POLICY`: conservative path/type/size/SVG policy used by authoring tools before platform admission.
- `PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST`: deterministic release-cohort fingerprint for the public security policy.
- `@promptframe/contracts/security-evaluator`: AST-aware evaluator for JS / TS / TSX source diagnostics.

## 布局源码检查

Node 作者工具使用 `@promptframe/contracts/layout-evaluator` 的 `evaluatePromptFrameLayoutPolicy`。
它按 JSX/React 样式、CSS 属性、局部变量和静态导入分析布局值；0、无单位 `lineHeight` 和 SVG 坐标不会被当作固定像素布局。
真实像素长度、固定外框和逃逸父容器的视口单位保留错误诊断，消息包含文件、行、列。
静态分支和对象展开分别检查；语法错误不会返回通过。此检查不执行组件代码，也不代替预览中的响应式验证。

该子路径包含 TypeScript 编译器，仅供 Node 作者检查使用。主入口保留轻量兼容检查和运行时合同，浏览器无需加载编译器；服务端源码准入与 CLI 应使用 AST 子路径。

## 运行依赖检查

`@promptframe/contracts/dependency-evaluator` 从提供的组件、schema 和 index 入口追踪静态运行导入。
只用于开发配置、测试且未被运行入口引用的 `devDependencies` 不进入运行依赖目录审核；仅在 dev 中声明但被运行代码导入的包仍会拒绝。
类型专用导入被擦除，运行可达文件不会因为 `.test` 文件名获得豁免。无法解析的本地引用和动态模块名会明确拒绝。
检查不安装依赖；冻结锁文件、隔离安装、安全扫描和传递依赖审核继续由原打包与平台流程完成。

## Public Security Policy

`PROMPTFRAME_PUBLIC_SECURITY_POLICY` is the public author-facing rule catalog used by CLI diagnostics. It intentionally describes the behavior an external component author must avoid, not PromptFrame platform internals.

High-risk browser/runtime capabilities are rejected locally when they are statically visible, including BroadcastChannel, WebRTC / RTCPeerConnection, Notification, Service Worker, clipboard access, navigator.locks, AudioContext / AudioWorklet, CSS.registerProperty, DOM Observer APIs, Remotion delayRender, and dynamic import. Fps hardcoded timing is a manual-review validation gate under `runtime.deterministic.fps_hardcoded_timing`; it reports timing literals in Remotion contexts and blocks local validation until authors use fps-aware helpers.

Each public rule exposes a stable `id`, severity, category, action, pattern set, optional AST matcher metadata, human reason, recommendation, optional `repairHint`, and documentation path so local CLI output, GitHub annotations, and platform admission can refer to the same author-facing diagnostic family.

The security evaluator subpath parses JS / TS / TSX source with the TypeScript compiler API, so comments, strings, and harmless local identifiers do not trigger the same diagnostics as real browser capability access. Regex patterns remain as compatibility and metadata fallback, not the preferred source-code admission path.
# Named content slots

With contracts 0.1.49 and CLI 0.1.86 or later, a component may declare an optional explanation area in its manifest:

```json
{"contentSlots":[{"name":"description","description":"Explanation below the diagram","maxChildren":2}]}
```

The host supplies `promptFrameContentSlots` separately from serializable props. In the component:

```tsx
import { promptFrameContentSlot, type PromptFrameContentSlots } from '@promptframe/contracts';
import type { ReactNode } from 'react';

export default function Example(props: {
  description?: string;
  promptFrameContentSlots?: PromptFrameContentSlots<ReactNode>;
}) {
  return <section>{promptFrameContentSlot(props, 'description',
    <p>{props.description ?? 'Default explanation'}</p>)}</section>;
}
```

Assign existing direct children in a VideoSpec node with `children: ["line1", "line2"]` and `slotByChildId: {"line1":"description","line2":"description"}`. The existing children order, graph, permissions and timing remain authoritative. Unassigned children continue through the normal `children` prop. No assignments or an empty mapping use the component's fallback text. Assigned content that is inactive, missing or unavailable must not silently become fallback text. Place each slot once and provide its local layout box and clipping.

The helper requires no component-kit update and does not change the runtime generation. Existing components without declarations keep their previous children behavior. Local preview reads declarations from the verified captured manifest; source-only drafts retain pending-upload status until a fixed component version is available for formal output.

## 模型读取期间的授权续期

`createPromptFrameModelReader` 在读取和摘要校验结束后重新核对宿主当前提供的同一引用、MIME、大小、SHA 和有效期限。同一表示的合法续期可接续在途读取；撤权、内容变化、真实到期和取消仍拒绝，单次读取的 15 秒预算不续期。返回的 ArrayBuffer 只包含验证过的 GLB 字节。

## 展示预设

`componentShowcaseSchema` 定义可选的 `defaultFrames` 和最多两个 `presets`。`resolveComponentShowcaseGroups` 以默认预览为底合并参数，生成准确的局部采样帧；对象递归合并，数组替换。调用方必须传入其正常预览使用的参数验证函数。`createComponentShowcasePropsValidator` 可校验公共静态 schema facts；资源授权、原渲染预算和组件运行期谓词继续由调用方处理。

解析失败抛出 `ComponentShowcaseError`，包含稳定 `code` 和字段 `path`，不携带原参数正文。该 helper 不加载组件模块，不访问素材、网络或文件。
