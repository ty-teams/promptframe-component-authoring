import {
  COMPONENT_REUSABILITY_CONTRACT_VERSION,
  componentReusabilityScoreSchema,
  extractPromptFrameRootPropKeys,
  type AuthoringUploadTarget,
  type ComponentManifest,
  type ComponentReusabilityScore,
} from '@promptframe/contracts';

export interface LocalReusabilityInput {
  manifest: ComponentManifest;
  componentSourceText: string;
  schemaSourceText: string;
  previewProps: Record<string, unknown>;
  uploadTarget: AuthoringUploadTarget;
  generatedAt?: string;
}

export interface LocalReusabilityDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  repairHint?: string;
}

export function evaluateLocalReusability(input: LocalReusabilityInput): ComponentReusabilityScore {
  const propKeys = inferSchemaPropKeys(input.schemaSourceText);
  const propCount = propKeys.length;
  const sourceLower = input.componentSourceText.toLowerCase();
  const manifestText = [
    input.manifest.displayName,
    input.manifest.description,
    ...input.manifest.tags,
    ...input.manifest.capabilityHints,
  ].join(' ').toLowerCase();
  const sourceUsesProps = /\bprops\./.test(input.componentSourceText);
  const previewPropKeys = Object.keys(asRecord(input.previewProps.props) ?? {});
  const hasDefaultedProps = propCount > 0 && /\.default\s*\(/.test(input.schemaSourceText);
  const hasArrayOrDataShape = /z\.array\s*\(|\b(items|data|metrics|rows|images|assets|slides)\b/i
    .test(input.schemaSourceText);
  const oneOffText = `${manifestText} ${sourceLower}`;
  const oneOffSignals = /\b(acme|q[1-4]|campaign|one[-\s]?off|poster|launch|event|conference|promo)\b/
    .test(oneOffText);
  const styleConfigurable = /\b(foreground|background|accent|brand|tone|styleintent|color|theme)\b/i
    .test(propKeys.join(' '));

  const signals: ComponentReusabilityScore['signals'] = [
    reusabilitySignal(
      'propsRichness',
      propCount >= 4 ? 1 : propCount >= 2 ? 0.75 : propCount === 1 ? 0.45 : 0.1,
      0.18,
      propCount > 0
        ? `schema exposes ${propCount} configurable prop${propCount === 1 ? '' : 's'}.`
        : 'schema exposes no configurable props; component is difficult to reuse.',
    ),
    reusabilitySignal(
      'hardcodedContentRisk',
      sourceUsesProps ? 0.85 : oneOffSignals ? 0.15 : 0.35,
      0.16,
      sourceUsesProps
        ? 'component source reads props, so visible content can be varied.'
        : 'component source appears mostly hardcoded; visible content is not driven by props.',
    ),
    reusabilitySignal(
      'dataShapeRichness',
      hasArrayOrDataShape ? 0.9 : propCount >= 3 ? 0.65 : propCount > 0 ? 0.4 : 0.2,
      0.12,
      hasArrayOrDataShape
        ? 'schema includes data/list-like signals.'
        : 'schema does not expose reusable list/data shape signals.',
    ),
    reusabilitySignal(
      'styleConfigurability',
      styleConfigurable ? 0.85 : propCount > 0 ? 0.45 : 0.2,
      0.16,
      styleConfigurable
        ? 'schema exposes style or brand customization knobs.'
        : 'style appears fixed or only weakly configurable.',
    ),
    reusabilitySignal(
      'domainNeutrality',
      oneOffSignals ? 0.2 : 0.75,
      0.18,
      oneOffSignals
        ? 'manifest/source contains one-off campaign or named-domain signals.'
        : 'manifest/source appears domain-neutral enough for marketplace reuse.',
    ),
    reusabilitySignal(
      'emptyStateSupport',
      hasDefaultedProps || /\?\?|\|\||\?/.test(input.componentSourceText) ? 0.75 : 0.25,
      0.1,
      hasDefaultedProps
        ? 'schema includes defaults for configurable props.'
        : 'empty/default-state handling is not obvious from schema/source.',
    ),
    reusabilitySignal(
      'previewCaseCoverage',
      propCount > 0 && previewPropKeys.length > 0 ? 0.7 : 0.2,
      0.1,
      previewPropKeys.length > 0
        ? `canonical preview exercises props: ${previewPropKeys.slice(0, 6).join(', ')}.`
        : 'canonical preview does not exercise configurable props.',
    ),
  ];
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const score = roundScore(signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight);
  const recommendation = input.uploadTarget === 'marketplace_authoring'
    ? score < 0.55 ? 'manual_review' : 'allow'
    : score < 0.55 ? 'warn' : 'allow';

  return componentReusabilityScoreSchema.parse({
    contractVersion: COMPONENT_REUSABILITY_CONTRACT_VERSION,
    uploadTarget: input.uploadTarget,
    targetVisibility: input.uploadTarget === 'marketplace_authoring' ? 'public' : 'project_private',
    score,
    recommendation,
    signals,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });
}

export function reusabilityDiagnostics(reusability: ComponentReusabilityScore): LocalReusabilityDiagnostic[] {
  if (reusability.recommendation === 'manual_review') {
    return [{
      code: 'component_market.reusability.marketplace_manual_review',
      severity: 'warning',
      message: `公开 marketplace authoring 复用性评分较低：score=${reusability.score}。`,
      repairHint: '请增加可配置 props、数据形态、风格控制和非一次性文案；项目私有组件可改走 project_private_generation lane。',
    }];
  }
  if (reusability.recommendation === 'warn') {
    return [{
      code: 'component_market.reusability.project_private_warning',
      severity: 'warning',
      message: `项目私有组件复用性评分较低：score=${reusability.score}；当前不阻断 project_private 使用。`,
      repairHint: '如后续要发布到 marketplace，请补可配置 props、数据形态和风格控制。',
    }];
  }
  return [{
    code: 'component_market.reusability.accepted',
    severity: 'info',
    message: `组件复用性 deterministic scoring 通过：score=${reusability.score}。`,
  }];
}

function reusabilitySignal(
  id: ComponentReusabilityScore['signals'][number]['id'],
  score: number,
  weight: number,
  reason: string,
): ComponentReusabilityScore['signals'][number] {
  const rounded = roundScore(score);
  return {
    id,
    score: rounded,
    weight,
    severity: rounded < 0.35 ? 'warning' : 'info',
    reason,
  };
}

function inferSchemaPropKeys(schemaSourceText: string): string[] {
  return extractPromptFrameRootPropKeys(schemaSourceText);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
