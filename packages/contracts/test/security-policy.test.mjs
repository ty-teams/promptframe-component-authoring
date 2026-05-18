import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMPTFRAME_PUBLIC_SECURITY_POLICY } from '../dist/index.js';

test('public security policy treats prompt injection strings as manual review', () => {
  const rule = PROMPTFRAME_PUBLIC_SECURITY_POLICY.warningApis.find((item) => (
    item.id === 'prompt.injection_string'
  ));

  assert.equal(rule?.action, 'manual_review');
  assert.equal(rule?.category, 'prompt_injection_string');
});
