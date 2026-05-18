# 组件市场检索元数据规则

> 本规则服务组件市场和 Director Agent 的 `search_components` 能力。目标不是让用户“填关键词骗搜索”，而是让平台用多路证据判断组件是否真的适合当前视频场景。

## 一句话结论

组件检索采用“宽召回 + 硬门槛 + 加权重排”：

1. **宽召回**：用户意图、组件标题、摘要、标签、源码语义、schema、预览画面、行为反馈都可以把候选拉进来。
2. **硬门槛**：租户可见性、artifact 完整性、policy、必填 props 是否能满足、版本/hash 是否有效，必须全部通过。
3. **加权重排**：平台证据权重大于用户自述；时长只是低权重适配信号，不作为主要命中依据。

这不是简单的“或”关系，也不是所有条件都“与”死。搜索阶段可以宽一点，最终排序和可用性必须严格。

## ComponentSearchIntent 建议结构

Director Agent 在调用 `search_components` 前，应把用户意图先收敛为结构化意图：

```ts
interface ComponentSearchIntent {
  intentSummary: string; // 一句话需求，例如“展示三组销售数据的科技感深色卡片”
  purpose: string;
  visualStyle?: string[];
  contentShape?: string[];
  requiredProps?: string[];
  motion?: string[];
  mediaNeed?: 'none' | 'image' | 'video' | 'audio' | 'mixed';
  duration?: {
    targetFrames?: number;
    tolerance?: 'loose' | 'normal' | 'strict';
  };
  references?: {
    imageAssetIds?: string[];
    videoAssetIds?: string[];
    textNotes?: string[];
  };
}
```

`intentSummary` 必须保留。它是最接近用户原始表达的一句话，适合做 query embedding（查询向量）和 BM25/BM25-like 文本召回；其它字段用于结构化过滤、重排和解释。

## 排序权重口径

首版建议权重：

| 信号 | 建议权重 | 说明 |
|------|----------|------|
| 平台证据 | 50% | 源码语义、schema 参数、预览画面、真实依赖、渲染能力、policy/trust。 |
| 用户可编辑描述 | 25% | 标题、摘要、详细描述、标签、适用场景、参数说明文案。 |
| 行为反馈 | 15% | star、使用次数、收藏、用户说“换一个/不合适”的隐式反馈。 |
| duration fit | 5% | 用户目标时长与组件 `designedDurationRange` 的匹配度。只做软信号。 |
| 冷启动保护 | 5% | 新组件少量曝光保护，避免永远输给老组件。 |

`durationFrames` 不应成为重权重。组件本身有 `designedDurationRange`，渲染层还有 `DurationTimeline` 自适应：时间不足时快进压缩，时间富裕时播完后 hold。因此时长只影响“更舒服/更自然”的排序，不应该让一个视觉和数据形态都匹配的组件被轻易排除。

## 候选太多时怎么收敛

检索层不要把所有宽召回结果直接交给 Director：

1. 每个通道先取 Top-K，例如标题/标签、用户描述向量、源码语义、schema、视觉预览、行为反馈各取有限候选。
2. 合并去重，用 `componentRef + version + hash` 做稳定 key。
3. 先跑硬门槛，剔除不可用候选。
4. 用加权分数重排。
5. 返回紧凑卡片时只给 Top 8-12，并附 `matchedReasons`（命中原因）和必要 diagnostics（诊断）。

后续可以引入 RRF（Reciprocal Rank Fusion，倒数排名融合）或学习排序，但首期先保持可解释的加权规则。

## 用户可编辑字段与平台证据字段

用户可以编辑：

- `displayName`：组件展示名。
- `summary`：一句话摘要。
- `description`：详细描述。
- `tags`：标签。
- `searchKeywords`：搜索关键词补充。
- `useCases`：适用场景。
- `styleHints`：视觉风格。
- `parameterDescriptions`：参数说明文案。
- `previewPresetDescription`：预览样例说明。
- `exampleUsage`：示例用法。
- `previewCopy`：预览文案。

平台自动生成且用户不能改：

- `componentRef` / `artifactId`。
- `sourceHash` / `schemaHash` / `bundleHash` / `manifestHash`。
- 真实 props schema。
- 真实依赖和入口。
- 组件类别推断。
- 源码语义向量。
- 参数语义向量。
- 预览画面语义向量。
- 渲染能力、限制、policy、trust level。

如果用户描述和平台证据明显冲突，不要直接拦死。首期处理方式是：

- 给作者提示“描述与平台证据不一致，可能影响搜索排序”。
- 对公开搜索降权。
- 在组件详情里展示平台推断的真实能力标签。

## 版本语义

组件市场同时维护两个版本概念：

- `artifactVersion`：源码、schema、依赖或构建产物变化时升级，影响渲染、hash、receipt、发布和回滚。
- `metadataRevision`：摘要、描述、标签、搜索关键词、参数说明文案变化时升级，只影响展示和搜索索引，不改变 bundle hash / schema hash。

改源码或真实 schema 必须重新构建。只改文案和搜索描述时，异步重建搜索索引即可。

## 图片 / 视频参考

用户上传参考图时，检索链路应先把图片转成 `VisualIntent`：

- 画面类型：数据面板、人物卡、商品展示、时间线等。
- 风格：深色、玻璃拟态、苹果式克制、霓虹、手绘等。
- 构图：卡片数量、主次层级、留白、对齐方式。
- 色彩和动效倾向。

然后把这些视觉意图和 `intentSummary` 一起参与组件召回。后续有 VLM/CLIP 类能力时，可以追加真实图像向量；没有时也必须有文本化视觉标签兜底。

视频参考首期不建议直接全量向量化。先抽关键帧 + 运动摘要，例如“数字增长、卡片 stagger 入场、循环背景粒子”，再走同一套文本/视觉意图匹配。

阶段建议：

- P0：图片参考。
- P1：视频关键帧参考。
- P2：完整视频运动风格匹配。

## Director Agent 决策规则

Director 不应该直接相信最高分第一名。它需要：

1. 调用 `search_components` 取得候选 compact cards。
2. 对前 3-5 名用 `get_component_schema` 精查 props。
3. 判断当前用户素材和数据能否填满必需 props。
4. 如果分数接近，优先选平台证据更强、渲染能力更完整、版本更稳定的组件。
5. 如果没有候选达到可信阈值，向用户追问或使用内置组件兜底。

组件不是独立 tools。Director 永远通过少量固定工具检索和加载组件，避免工具数量随着市场膨胀。

候选 compact card 建议包含：

- `matchReasons`：命中原因。
- `warnings`：描述不一致、时长偏离、policy 风险等。
- `previewMedia`：still/GIF/MP4 预览。
- `scoreBreakdown`：平台证据、用户描述、行为反馈、时长适配、冷启动保护各自得分。

## 描述一致性检测

首期做规则 + LLM 摘要 + embedding 相似度即可：

1. 生成用户描述摘要。
2. 生成平台证据摘要。
3. 比较二者相似度。
4. 描述出现高风险能力词但源码/schema/preview 没证据时，生成 warning。

处理方式：不直接拦截；降低用户描述权重；Web Admin 展示“描述可信度偏低”；给作者修正文案建议。
