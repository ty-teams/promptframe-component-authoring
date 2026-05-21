# 组件市场时序 SSOT 规则

> 本文件是 PromptFrame 组件作者的公开时序规则，说明组件市场场景下如何保持确定性 frame-driven 动画和时长自适应。

## 一句话结论

组件市场组件必须和平台内置视频组件共用同一套时序心智：

- `designedDurationRange` 是组件舒服播放的设计区间。
- `durationFrames` 是本次使用场景给它的实际时长。
- 时间不足时快进压缩，时间富裕时播完后 hold。
- 禁止因为组件想播更久，就让引擎层静默延长 Scene。

## 市场组件必须声明什么

`manifest.json` 必须包含：

```json
{
  "designedDurationRange": {
    "min": 90,
    "max": 180
  }
}
```

这个字段进入三个地方：

1. **搜索排序**：作为低权重 `duration fit` 信号。
2. **默认预览**：平台生成 still/GIF/MP4 预览时限制最大帧数，避免恶意耗算力。
3. **渲染诊断**：当实际场景给的时长极端不合理时，给 warning，而不是直接让组件消失。

## 为什么不是硬过滤

用户要 120 帧，组件推荐 90-180 帧，当然很匹配。用户要 240 帧，这个组件也可能可以用：动作按原速播完后 hold。用户只给 60 帧，它也可能可以用：动作会按 `DurationTimeline` 快进压缩。

所以时长不能是主匹配条件。它只回答“这个组件在这个时长下是否舒服”，不回答“这个组件是否符合用户目的”。

## 源码依赖如何保持 SSOT

现状：

- 内置组件的 `createDurationTimeline()` 位于 `packages/renderer/src/components/scene_templates/shared/DurationTimeline.ts`。
- 市场脚手架不能直接 import 这个 renderer 内部路径，因为外部组件会独立打包、上传、验收。

推荐演进：

1. 抽出很小的 `@promptframe/component-kit` 包。
2. 只放平台标准组件真正需要的轻量 API：
   - `createDurationTimeline()`
   - `scaledSpringProgress()` 或等价 helper
   - manifest/schema 类型
   - preview constraints 类型
3. `react`、`remotion` 只作为 peer dependency（同伴依赖），不要把平台内部渲染实现打进组件包。
4. 脚手架模板锁定 `component-kit` 版本，manifest 写入 `standardVersion` / `standardSourceHash`。
5. 服务端 build admission 校验 `component-kit` 版本、manifest 标准版本和源码禁用项。

这样 npm 包是可靠且轻量的；不建议让市场组件依赖平台内部 renderer，那会把内部实现、体积和破坏性升级都带给组件作者。

在 `component-kit` 落地前，组件市场 skill 必须明文引用项目级时序规则，并由模板 README 告诉组件作者：先按 manifest 的 `designedDurationRange` 和 frame-driven 方式写确定性动画，不要引入 CSS 动画、计时器或真实时间。

## 上传验收应检查什么

首期至少检查：

- `manifest.json` 有合法 `designedDurationRange.min/max`。
- `src/preview-props.json` 的 `durationFrames` 不超过平台预览上限。
- 组件源码使用 `useCurrentFrame()` / `useVideoConfig()`。
- 没有 CSS `transition`、`@keyframes`、`Date.now()`、`Math.random()` 等非确定性路径。

后续 `component-kit` 落地后追加：

- 必须从 `@promptframe/component-kit` 引入时序 helper，禁止复制内部实现。
- `DESIGNED_DURATION_RANGE` / manifest / preview props 能被构建脚本交叉校验。
