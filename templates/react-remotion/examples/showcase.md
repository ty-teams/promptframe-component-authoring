# 展示预设

默认展示使用 `src/preview-props.json`。需要演示两种参数组合时，可把本目录的 `showcase.json` 复制到 `src/showcase.json`，再按组件的真实 props 调整。

默认组之外最多添加两组。对象属性逐字段合并，数组整体替换；每组的完整参数都必须满足组件 schema。示例的帧号对应 120 帧预览；修改时长后可删除 `defaultFrames`，使用自动取样，或填写 6–8 个互异递增且未越界的局部帧。少于六帧的短片使用全部不同帧。

运行 `promptframe check .` 和 `promptframe package .` 检查声明。源码中的展示素材沿包内示例引用；本机试用文件继续通过预览资源选择入口提供，不写入展示声明。
