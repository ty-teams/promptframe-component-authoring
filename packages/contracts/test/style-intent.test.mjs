import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectPromptFrameUnknownCustomStyleProps,
  PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE,
  promptFrameStyleIntentSchema,
  PROMPTFRAME_STYLE_CONTRACT_VERSION,
} from '../dist/index.js';

test('style intent contract accepts public authoring style controls', () => {
  const intent = promptFrameStyleIntentSchema.parse({
    contractVersion: PROMPTFRAME_STYLE_CONTRACT_VERSION,
    stylePackId: 'business-clean',
    tone: 'tech',
    accentColor: '#38bdf8',
    density: 'balanced',
    motionIntensity: 'subtle',
    fontScale: 'normal',
    brandTokens: {
      primaryColor: '#0f172a',
      logoAssetId: 'asset://logo-123',
      fontFamilyHint: 'Inter',
    },
  });

  assert.equal(intent.tone, 'tech');
  assert.equal(intent.brandTokens?.logoAssetId, 'asset://logo-123');
});

test('style prop policy detects root-level private style props without flagging styleIntent internals', () => {
  const findings = detectPromptFrameUnknownCustomStyleProps([
    'import { z } from "zod";',
    'export const propsSchema = z.object({',
    '  title: z.string(),',
    '  theme: z.string().optional(),',
    '  foregroundColor: z.string().optional(),',
    '  styleIntent: z.object({',
    '    accentColor: z.string().optional(),',
    '    brandTokens: z.object({ primaryColor: z.string().optional() }).optional(),',
    '  }).optional(),',
    '});',
  ].join('\n'));

  assert.equal(PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.id, 'component.style.unknown_custom_style_prop');
  assert.deepEqual(findings.map((finding) => finding.propName), ['foregroundColor', 'theme']);
  assert.ok(findings.every((finding) => finding.ruleId === PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.id));
});
