import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
