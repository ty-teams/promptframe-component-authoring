# 组件市场时序 SSOT 规则

> 本文件是 PromptFrame 组件作者的公开时序规则，说明组件市场场景下如何保持确定性 frame-driven 动画和时长自适应。

## 一句话结论

组件市场组件必须和平台内置视频组件共用同一套时序心智：

- `designedDurationRange` 是组件舒服播放的设计区间。
- `durationFrames` 是本次使用场景给它的实际时长。
- `fps` 是本次渲染的一秒多少帧；所有秒数、延迟、交错和弹簧 fps 都必须从 `fps` 或 timeline helper 推导，不能把 30fps 下的帧数写死。
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

组件市场 skill 必须明文引用项目级时序规则，并由模板 README 告诉组件作者：先按 manifest 的 `designedDurationRange`、`fps` 和 frame-driven 方式写确定性动画，不要引入 CSS 动画、计时器或真实时间。

## fps-aware timing（fps 自适应）规则

外部组件不能假设所有视频永远是 30fps。平台主干会使用 30fps / 60fps 这类受控帧率；组件如果写死 `30`、`45`、`60` 这样的“帧数时间点”，在 60fps 下会把 1 秒动作压成 0.5 秒。

推荐写法：

```tsx
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { createDurationTimeline, createRevealPhases, secondsToFrames } from '@promptframe/component-kit/timing';

export function Component() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const timeline = createDurationTimeline({ actualDuration: durationInFrames, designedDuration: secondsToFrames(4, fps) });
  const reveal = createRevealPhases({ fps, timeline, enterSeconds: 0.5, revealSeconds: 1.5, exitSeconds: 3 });
  const opacity = interpolate(frame, reveal.enterRange, [0, 1], { extrapolateRight: 'clamp' });
  return <div style={{ opacity }} />;
}
```

不推荐写法：

```tsx
interpolate(frame, [30, 60], [0, 1]);
spring({ frame, fps: 30 });
const visible = frame > 45;
```

`createPreviewCaseMatrix()` 可用 `fpsPresets: [30, 60]` 生成本地 fps-adaptive diagnostics（fps 自适应诊断）case，用来比较同一个 props / aspect 在 30fps 和 60fps 下的节奏；也可用 `durationScalePresets: [0.5, 2]` 生成 designed-duration diagnostics，用来观察压缩与 hold 表现。当前 `src/preview-props.json` 仍受公开 preview policy 约束，且 `durationFrames` 必须落在 `manifest.designedDurationRange`；在公开标准允许 60fps 前，不要把 60fps local case 当成可上传的 source evidence。

当前 AST 检测规则：

- Rule ID: `runtime.deterministic.fps_hardcoded_timing`
- Action: `manual_review`；CLI `validate --json` 会阻断，`check --json` 会在 diagnostics 中报告，作者必须先改成 fps-aware timing。
- 检测对象：`interpolate(frame, [30, 60], ...)`、`spring({ frame, fps: 30 })`、`frame > 45` / `frame < 90`、`<Sequence from={30} durationInFrames={60}>` 等疑似硬编码时间点。
- 白名单：区间或比较表达式使用 `fps`、`secondsToFrames()`、`timeline.at()`、`timeline.frame()`、`createRevealPhases()`、`createFillProgress()`，或者是纯布局尺寸/数组长度/颜色常量时不报。
- repairHint：Use `secondsToFrames(seconds, fps)`, `createRevealPhases()`, `createFillProgress()` or `createDurationTimeline()` / `timeline.at()` from `@promptframe/component-kit/timing`.
- Fixture matrix：literal bad cases、comment/string false positives、`secondsToFrames` good cases、`timeline.at()` good cases、`spring({ fps })` good case、layout numeric constants good case.

## 上传验收应检查什么

首期至少检查：

- `manifest.json` 有合法 `designedDurationRange.min/max`。
- `src/preview-props.json` 的 `durationFrames` 不超过平台预览上限，并且落在 `manifest.designedDurationRange` 内。
- 组件源码使用 `useCurrentFrame()` / `useVideoConfig()`。
- 没有 CSS `transition`、`@keyframes`、`Date.now()`、`Math.random()` 等非确定性路径。

后续 `component-kit` 落地后追加：

- 必须从 `@promptframe/component-kit` 引入时序 helper，禁止复制内部实现。
- `designedDurationRange` / manifest / preview props 能被 `validate` 交叉校验。
- CLI check / upload admission 如启用 fps-aware timing 规则，必须使用 AST evaluator，不使用正则扫描注释或字符串。
