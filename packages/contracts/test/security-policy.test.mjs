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

test('public security policy exposes browser capability rule IDs with author guidance', () => {
  const requiredRuleIds = [
    'browser.broadcast_channel',
    'browser.webrtc',
    'browser.notification',
    'browser.service_worker',
    'browser.clipboard',
    'browser.navigator_locks',
    'browser.audio_context',
    'browser.css_register_property',
    'browser.observer_abuse',
    'remotion.delay_render',
    'code.dynamic_import',
  ];
  const rules = [
    ...PROMPTFRAME_PUBLIC_SECURITY_POLICY.forbiddenApis,
    ...PROMPTFRAME_PUBLIC_SECURITY_POLICY.mediatedApis,
    ...PROMPTFRAME_PUBLIC_SECURITY_POLICY.warningApis,
  ];
  const byId = new Map(rules.map((rule) => [rule.id, rule]));

  for (const ruleId of requiredRuleIds) {
    const rule = byId.get(ruleId);
    assert.ok(rule, `${ruleId} should be present`);
    assert.equal(typeof rule.label, 'string', `${ruleId} label`);
    assert.equal(typeof rule.severity, 'string', `${ruleId} severity`);
    assert.equal(typeof rule.category, 'string', `${ruleId} category`);
    assert.equal(typeof (rule.action ?? rule.defaultAction), 'string', `${ruleId} action`);
    assert.ok(Array.isArray(rule.patterns) || Array.isArray(rule.rawApis), `${ruleId} patterns/rawApis`);
    assert.equal(typeof rule.reason, 'string', `${ruleId} reason`);
    assert.equal(typeof rule.recommendation, 'string', `${ruleId} recommendation`);
    assert.equal(typeof rule.docsPath, 'string', `${ruleId} docsPath`);
    assert.match(rule.docsPath, /^\/docs\/component-authoring\/security#/);
  }
});
