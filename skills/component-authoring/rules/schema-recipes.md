# Schema Recipes：动态数据组件常见参数写法

本文件给外部 AI 一个可直接参考的 props schema（组件参数结构）方向。最终是否合格仍以 `promptframe validate`、在线标准 API 和服务端 build admission 为准。

## 总原则

- schema 描述的是组件真实可配置能力，不是营销文案。
- 字段名要稳定、短、语义清楚，避免 `data1/data2/itemX` 这类难检索名字。
- 每个必填字段都要能从 `src/preview-props.json` 给出默认示例，否则平台无法稳定生成预览。
- 数字字段要明确单位，例如 `value`、`unit`、`suffix`、`percent`、`count` 不要混用。
- 正负变化值建议拆成 `deltaValue` + `deltaDirection`，不要只靠正负号猜含义。

## 增长指标卡片

适合“销售额增长、转化率提升、用户数上涨”。

推荐字段：

```ts
export const metricSchema = z.object({
  label: z.string().describe('指标名称，例如 销售额'),
  value: z.number().describe('当前指标值'),
  unit: z.string().default('').describe('前缀单位，例如 ¥'),
  suffix: z.string().default('').describe('后缀单位，例如 % 或 万'),
  deltaValue: z.number().default(0).describe('变化幅度的绝对值'),
  deltaDirection: z.enum(['up', 'down', 'flat']).default('flat').describe('变化方向'),
});
```

使用建议：

- `deltaDirection` 用于颜色、箭头和排序解释。
- `deltaValue` 不直接决定好坏；好坏需要结合业务语义，先只表达“涨/跌/持平”。

## 对比指标

适合“本周 vs 上周、A 产品 vs B 产品、目标 vs 实际”。

推荐字段：

```ts
export const comparisonItemSchema = z.object({
  name: z.string().describe('对比对象名称'),
  value: z.number().describe('数值'),
  label: z.string().optional().describe('显示标签'),
  color: z.string().optional().describe('可选主题色，建议使用十六进制颜色'),
});
```

使用建议：

- 两组对比用 `items: z.array(comparisonItemSchema).min(2).max(4)`。
- 如果要表达目标线，使用单独字段 `targetValue`，不要把目标混进普通 `items`。

## 漏斗阶段

适合“访问 -> 加购 -> 下单 -> 支付”的转化流程。

推荐字段：

```ts
export const funnelStageSchema = z.object({
  id: z.string().describe('稳定阶段 id，例如 visit/add_to_cart/pay'),
  label: z.string().describe('阶段名称'),
  value: z.number().describe('阶段人数或次数'),
  conversionRate: z.number().min(0).max(1).optional().describe('从上一阶段到本阶段的转化率'),
});
```

使用建议：

- `id` 必须稳定，便于 Director Agent 和测试用例识别阶段。
- `conversionRate` 用 0-1，不用 0-100；展示时组件自己转成百分比文案。
- 阶段数量建议 `min(2).max(6)`，避免预览和视频里拥挤。

## 正负 Delta 展示

适合“上涨 12%、下降 8%、持平”。

推荐字段：

```ts
export const deltaSchema = z.object({
  deltaValue: z.number().default(0).describe('变化幅度，使用正数表达幅度'),
  deltaDirection: z.enum(['up', 'down', 'flat']).default('flat').describe('变化方向'),
  deltaLabel: z.string().optional().describe('补充说明，例如 较上月'),
});
```

使用建议：

- `deltaValue` 保持正数，方向交给 `deltaDirection`。
- 颜色、箭头、动效由 `deltaDirection` 驱动。
- 如果业务里“下降”反而是好事，先用中性文案，不要在 schema 里硬编码红绿含义。

## preview-props 示例要求

动态数据组件必须在 `src/preview-props.json` 放一组可展示的真实样例：

```json
{
  "width": 1280,
  "height": 720,
  "fps": 30,
  "durationFrames": 120,
  "props": {
    "title": "Sales Funnel Pulse",
    "stages": [
      { "id": "visit", "label": "访问", "value": 12000 },
      { "id": "cart", "label": "加购", "value": 3600, "conversionRate": 0.3 },
      { "id": "paid", "label": "支付", "value": 1080, "conversionRate": 0.3 }
    ]
  }
}
```

预览样例不是随便填的假数据。它会影响组件市场预览、视觉索引、Director Agent 对组件能力的理解，以及后续 QA 验收。
