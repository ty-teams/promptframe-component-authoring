export type TerminalLanguage = 'en' | 'zh';

/** Locale selection affects terminal presentation, never policies or saved reports. */
export function terminalLanguage(env: NodeJS.ProcessEnv = process.env): TerminalLanguage {
  const locale = [env.PROMPTFRAME_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG]
    .find(value => value?.trim())?.trim() ?? 'en';
  return /^zh(?:$|[-_.@])/i.test(locale) ? 'zh' : 'en';
}

type Phrase = readonly [string, string];
const phrases: Record<string, readonly Phrase[]> = {
  'standard.completed': [['Public PromptFrame component standard fetched.', '已读取公开 PromptFrame 组件标准。']],
  'doctor.completed': [['Component directory contains required authoring files.', '组件目录包含全部必需的创作文件。']],
  'doctor.required_files.missing': [['Missing required files: ', '缺少必需文件：']],
  'upgrade.mode.conflict': [['upgrade accepts either --apply or --dry-run, not both.', 'upgrade 的 --apply 与 --dry-run 不能同时使用。']],
  'upgrade.package_json.missing': [['package.json is required before running upgrade.', '运行 upgrade 前需要 package.json。']],
  'upgrade.package_json.invalid': [['package.json must be valid JSON before running upgrade.', '运行 upgrade 前，package.json 必须是有效的 JSON。']],
  'upgrade.applied': [['PromptFrame authoring package floors were updated.', '已更新 PromptFrame 创作包的最低版本要求。']],
  'upgrade.dry_run': [['PromptFrame authoring package floor changes were computed without writing files.', '已计算 PromptFrame 创作包最低版本的变更，未写入文件。']],
  'scaffold.template.stale': [
    ['PromptFrame scaffold template is stale: ', 'PromptFrame 脚手架模板已过时：'],
    ['. Review latest scaffold changes before upload.', '。上传前请检查新版脚手架的变更。'],
    ['Run promptframe upgrade . --check-latest to review local scaffold freshness (package floors and template digest; this does not query npm latest), then regenerate or manually port the latest scaffold shell changes.',
      '运行 promptframe upgrade . --check-latest 检查本地脚手架（包最低版本和模板摘要，不查询 npm latest），再重新生成或手动迁入新版预览壳变更。'],
  ],
  'standard.freshness.current': [
    ['Local authoring standard matches the current public release.', '本地创作标准与当前公开发行版一致。'],
    ['The local authoring standard and required package minimums are compatible with this platform.', '本地创作标准和包最低版本与此平台兼容。'],
  ],
  'standard.freshness.release_promotion_invalid': [
    ['PromptFrame platform returned an invalid authoring release promotion stage. Wait for platform rollout recovery; do not infer stable/current completion.',
      'PromptFrame 平台返回了无效的创作发行阶段。请等待平台恢复，不能据此判定稳定版或当前版已就绪。'],
  ],
  'standard.freshness.local_below_floor': [
    ['Local PromptFrame authoring packages are below this platform deployment minimum, even if the Component Standard source hash is unchanged.',
      '本地 PromptFrame 创作包低于此平台的最低版本要求，即使组件标准的源码摘要相同也需升级。'],
    ['Run ', '运行 '],
    [' and then promptframe sync . --apply before dev/check/upload.', '，然后运行 promptframe sync . --apply，再执行 dev/check/upload。'],
  ],
  'standard.freshness.platform_behind': [
    ['PromptFrame authoring release is newer than this platform deployment: ', '本地 PromptFrame 创作发行版比此平台新：'],
    ['Local dev/check may continue with a warning, but upload is blocked until the platform rollout catches up.', '本地 dev/check 可带警告继续；平台更新完成前禁止上传。'],
    ['Use the platform-compatible cohort advertised by this deployment, or wait for platform rollout; promptframe upgrade . --apply cannot fix platform-behind skew.',
      '请使用此平台公布的兼容包组合，或等待平台更新；promptframe upgrade . --apply 无法解决平台版本落后。'],
  ],
  'standard.freshness.upload_blocking': [
    ['PromptFrame component standard is stale: ', '本地 PromptFrame 组件标准已过时：'],
    ['Run ', '运行 '],
    [' and then promptframe sync . --apply before upload.', '，然后运行 promptframe sync . --apply，再上传。'],
  ],
  'standard.freshness.recommended_update': [
    ['Local PromptFrame authoring packages satisfy each platform minimum and use the same standard; dev/check/upload may continue.',
      '本地 PromptFrame 创作包满足平台各项最低版本要求且标准相同，可继续 dev/check/upload。'],
    ['Optional compatible updates: ', '可选的兼容更新：'],
    ['; then promptframe sync . --apply. Versions already ahead are preserved.', '；然后运行 promptframe sync . --apply。已高于推荐的版本保留。'],
  ],
  'standard.freshness.compatible_versions': [
    ['Package versions differ from this deployment recommendation, but each minimum and the component standard match. Dev/check/upload may continue; no downgrade is required.',
      '包版本与此平台的推荐组合不同，但满足各项最低版本要求且组件标准一致。可继续 dev/check/upload，无需降级。'],
  ],
  'standard.freshness.offline_degraded': [
    [' ran local policy and package checks without a platform endpoint; online standard sourceHash freshness was skipped.', ' 已完成本地策略和包检查；未配置平台地址，跳过在线标准 sourceHash 检查。'],
    [' could not reach the platform standard endpoint; local checks passed but online sourceHash freshness is degraded.', ' 无法连接平台标准接口；本地检查通过，在线 sourceHash 状态未确认。'],
    [' platform standard response did not include sourceHash; local checks passed but online freshness is degraded.', ' 收到的平台标准未包含 sourceHash；本地检查通过，在线标准状态未确认。'],
  ],
  'standard.freshness.remote_invalid': [['PromptFrame standard endpoint did not return a sourceHash.', 'PromptFrame 标准接口未返回 sourceHash。']],
  'standard.release.promoting': [
    ['This endpoint is serving candidate authoring release ', '此接口提供创作候选发行版 '],
    ['; stable promotion is still pending.', '；稳定版发布仍未完成。'],
    ['Candidate cohort: ', '候选包组合：'], ['Responsibility: ', '负责方：'],
    ['; local package upgrades cannot complete npm latest/platform promotion.', '；本地包升级不能完成 npm latest 或平台发布。'],
    ['Dev/check and isolated canary upload may continue, but this result does not claim stable/current release completion.',
      '可继续 dev/check 和隔离试用上传，但此结果不代表稳定版或当前版发布完成。'],
  ],
  'component.layout.manifest_required': [
    ['Component manifest must declare layout capability for new uploads and new versions.', '新上传和新版本必须在 manifest 中声明布局能力。'],
    ['Add manifest.layout with layoutMode, recommendedSlot, minReadableSize, supportedAspectRatios, layoutAdaptivity, overflowPolicy and safeAreaPolicy.',
      '添加 manifest.layout，并填写 layoutMode、recommendedSlot、minReadableSize、supportedAspectRatios、layoutAdaptivity、overflowPolicy 和 safeAreaPolicy。'],
  ],
  'component.layout.manifest_invalid': [
    ['Component manifest layout capability is incomplete or invalid.', '组件 manifest 的布局能力不完整或无效。'],
    ['Fill every required layout field and keep historical manifests tolerant only on read paths, not new admission.', '填写全部必需的布局字段。历史 manifest 的兼容读取不适用于新上传。'],
  ],
  'component.style.global_css_forbidden': [
    ['External component CSS must not target global document selectors in ', '外部组件 CSS 不得使用文档全局选择器：'],
    ['Use CSS Module scoped class names inside the component boundary.', '在组件边界内使用 CSS Module 的局部类名。'],
  ],
  'component.style.unknown_custom_style_prop': [
    ['Root-level private style props are not part of the public PromptFrame style contract.', '根级私有样式 props 不属于公开 PromptFrame 样式合同。'],
    ['Move visual style controls under styleIntent, for example styleIntent.accentColor or styleIntent.brandTokens.primaryColor, then render with resolvePromptFrameStyle() from @promptframe/component-kit/style instead of custom color/theme/style props.',
      '将视觉样式放入 styleIntent，例如 styleIntent.accentColor 或 styleIntent.brandTokens.primaryColor，并用 @promptframe/component-kit/style 的 resolvePromptFrameStyle() 渲染，避免自定义根级 color/theme/style props。'],
  ],
};
const layoutPhrases: readonly Phrase[] = [
  ['style defines fixed final width/height', '样式固定了最终宽高'],
  ['escapes the parent slot', '超出了父级槽范围'],
  ['contains an unscaled pixel length', '包含未缩放的像素长度'],
  ['conflicting source bytes for one path', '同一路径存在不同源码'],
  ['component source format is unresolved', '无法解析组件源码格式'],
  ['too many static style branches', '静态样式分支过多'],
  ['too many static JSX props branches', '静态 JSX props 分支过多'],
  ['source syntax is unresolved', '无法解析源码语法'],
  ['Fix the source syntax before checking layout.', '修复源码语法后再检查布局。'],
  ['Use parent-slot-relative sizing or component-kit layout.px()/layout.clamp() for design-space lengths.', '相对于父级槽设置尺寸，或用 component-kit 的 layout.px()/layout.clamp() 表达设计尺寸。'],
  ['Let the platform/Director own the outer slot. The root should fill its parent; move design-space sizing through @promptframe/component-kit/layout.', '由平台或 Director 决定外层槽；根节点填满父级，设计尺寸通过 @promptframe/component-kit/layout 缩放。'],
  ['Use parent-slot-relative sizing and layout.px()/layout.clamp() instead of 100vw/100vh.', '使用父级槽相对尺寸及 layout.px()/layout.clamp()，避免 100vw/100vh。'],
  ['Route design-space dimensions through @promptframe/component-kit/layout so the component scales with the assigned slot.', '通过 @promptframe/component-kit/layout 换算设计尺寸，让组件随分配的槽缩放。'],
  ['Component root appears to define a fixed final width/height in ', '组件根节点似乎固定了最终宽高：'],
  ['Component source uses viewport units that can escape the platform slot in ', '组件使用了可能超出平台槽的视口单位：'],
  ['Component source contains high-risk naked px layout values in ', '组件包含高风险裸 px 布局值：'],
];
const layoutCodes = new Set(['component.layout.root_fixed_size', 'component.layout.root_viewport_unit',
  'component.layout.naked_px_high_risk', 'component.layout.naked_px_medium_risk', 'component.layout.source_parse_unresolved']);

export function terminalDiagnostic<T extends {code: string; message: string; repairHint?: string}>(
  value: T, language: TerminalLanguage = terminalLanguage(),
): T {
  if (language === 'en') return value;
  const replacements = phrases[value.code] ?? (layoutCodes.has(value.code) ? layoutPhrases : undefined);
  if (!replacements && value.code !== 'standard.freshness.fetch_failed') return value;
  const translate = (text: string) => {
    if (value.code === 'standard.freshness.fetch_failed') return '读取平台组件标准失败：' + text;
    // AST locations are user data; translate the diagnostic body only.
    const location = value.code.startsWith('component.layout.') ? /^(.*?:\d+:\d+: )([\s\S]*)$/.exec(text) : null;
    let result = location ? location[2]! : text;
    for (const [original, translated] of replacements!) result = result.replaceAll(original, translated);
    if (value.code.startsWith('component.layout.') && replacements !== layoutPhrases) {
      for (const [original, translated] of layoutPhrases) result = result.replaceAll(original, translated);
    }
    return (location?.[1] ?? '') + result;
  };
  return {...value, message: translate(value.message), ...(value.repairHint ? {repairHint: translate(value.repairHint)} : {})};
}

/** Only known CLI report slots are visited. Manifest/props/source/API data stays byte-for-byte content-equivalent. */
export function terminalOutput(value: unknown, language = terminalLanguage()): unknown {
  if (language === 'en' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>, output = {...input};
  for (const key of ['diagnostic', 'diagnostics']) {
    const translate = (item: unknown) => {
      if (!item || typeof item !== 'object') return item;
      const row = item as Record<string, unknown>;
      return typeof row.code === 'string' && typeof row.message === 'string'
        && (row.repairHint === undefined || typeof row.repairHint === 'string')
        ? terminalDiagnostic(row as {code: string; message: string; repairHint?: string}, language) : item;
    };
    output[key] = Array.isArray(input[key]) ? input[key].map(translate) : translate(input[key]);
    if (!(key in input)) delete output[key];
  }
  for (const key of ['freshness', 'localReusability', 'dependencyPolicy', 'publicResources', 'build']) {
    if (key in input) output[key] = terminalOutput(input[key], language);
  }
  if (Array.isArray(input.components) && input.command === 'check' && input.workspace === true) {
    output.components = input.components.map(row => terminalOutput(row, language));
  }
  if (typeof input.failureReason === 'string' && input.diagnostic && typeof input.diagnostic === 'object') {
    const code = (input.diagnostic as {code?: unknown}).code;
    if (typeof code === 'string') output.failureReason = terminalDiagnostic({code, message: input.failureReason}, language).message;
  }
  return output;
}

export function terminalHeading(english: string, chinese: string): string {
  return terminalLanguage() === 'zh' ? chinese : english;
}
