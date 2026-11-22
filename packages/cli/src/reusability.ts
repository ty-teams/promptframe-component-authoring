import { evaluateSchemaReusability } from '@promptframe/contracts/reusability-evaluator';
import {
  COMPONENT_REUSABILITY_CONTRACT_VERSION,
  componentReusabilityScoreSchema,
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
  const assessment = evaluateSchemaReusability({
    schemaSourceText: input.schemaSourceText,
    previewProps: input.previewProps.props,
  });
  return componentReusabilityScoreSchema.parse({
    contractVersion: COMPONENT_REUSABILITY_CONTRACT_VERSION,
    uploadTarget: input.uploadTarget,
    targetVisibility: input.uploadTarget === 'marketplace_authoring' ? 'public' : 'project_private',
    score: assessment.score,
    recommendation: assessment.recommendation,
    signals: assessment.signals,
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
      code: 'component_market.reusability.schema_advisory',
      severity: 'warning',
      message: `Schema and preview reuse evidence is incomplete: coverage=${reusability.score}. This advisory is not a security or publication decision.`,
      repairHint: 'Check configurable inputs, defaults and valid preview values for this version. Saving and public review retain their own contracts.',
    }];
  }
  return [{
    code: 'component_market.reusability.accepted',
    severity: 'info',
    message: `Schema and preview reuse evidence observed: coverage=${reusability.score}. Rendered behavior must be verified separately.`,
  }];
}
