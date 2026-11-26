# 组件的确定性时间与时长适配

组件使用实际 FPS 和绝对帧位置计算画面。相同参数、帧位置和素材应得到相同结果，拖动和逐帧渲染不依赖之前播放过哪些帧。

## 时长与帧率

- `manifest.designedDurationRange` 声明设计时长区间，单位为帧。
- `useVideoConfig().durationInFrames` 是本次画面的实际时长；组件不能静默延长场景。
- 从 `useVideoConfig().fps` 读取帧率，以 `Math.round(seconds * fps)` 换算秒数。
- 时间不足时按组件设计压缩关键动作；时间充裕时可保持最终状态。
- 使用 Remotion 的 `interpolate()`、`spring()`、`Sequence` 或组件自身明确的帧换算，不要求独立 Kit 时序 helper。
- 禁止用 CSS `transition`、`@keyframes`、计时器、`Date.now()` 或 `Math.random()` 推进视频时间。

```json
{"designedDurationRange":{"min":90,"max":180}}
```

## fps-aware timing（fps 自适应）示例

```tsx
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export function Component() {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const enterEnd = Math.max(1, Math.min(durationInFrames - 1, Math.round(0.5 * fps)));
  const opacity = interpolate(frame, [0, enterEnd], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return <div style={{opacity}} />;
}
```

这些写法会把时间绑定到固定帧率，应按实际 FPS 修正：

```tsx
interpolate(frame, [30, 60], [0, 1]);
spring({frame, fps: 30});
const visible = frame > 45;
```

## 诊断与本地检查

`runtime.deterministic.fps_hardcoded_timing` 是 `manual_review` 校验门禁。CLI `validate --json` 会阻断，`check --json` 会报告同一规则；诊断提示读取实际 FPS、换算帧数并使用绝对帧位置。规则继续检查疑似硬编码的动画时间点，布局尺寸、数组长度和颜色常量沿原边界处理，不以是否导入某个 helper 判断组件质量。

使用 `createPreviewCaseMatrix()` 的 `fpsPresets: [30, 60]` 比较 30fps / 60fps，并用 `durationScalePresets: [0.5, 2]` 检查时长压缩与保持。`src/preview-props.json` 仍受公开预览合同和 `manifest.designedDurationRange` 约束；默认预览最多30秒，本地60fps诊断不自动成为可上传的源码证据。

组件工程固定依赖版本，使用 CLI 的标准读取和校验检查 manifest、schema、预览及依赖。Kit 的字体、GLB准备、布局和预览入口保持各自公开合同。已有锁定组件沿其准确版本读取、预览和渲染，不因新的作者示例而替换历史依赖。
