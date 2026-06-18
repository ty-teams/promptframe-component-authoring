import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPONENT_SECURITY_POLICY_DIGEST_VERSION,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
  createPromptFramePublicSecurityPolicyDigest,
} from '../dist/index.js';

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
    'browser.image_beacon',
    'browser.audio_beacon',
    'browser.worker_context',
    'browser.window_open',
    'browser.cross_context_message',
    'browser.dynamic_script',
    'browser.iframe_escape',
    'browser.fingerprint',
    'storage.browser_storage',
    'dom.dangerous_html',
    'remotion.delay_render',
    'code.dynamic_import',
    'runtime.deterministic.fps_hardcoded_timing',
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

test('public security policy exposes fps hardcoded timing as warning-first guidance', () => {
  const rule = PROMPTFRAME_PUBLIC_SECURITY_POLICY.warningApis.find((item) => (
    item.id === 'runtime.deterministic.fps_hardcoded_timing'
  ));

  assert.equal(rule?.action, 'warn');
  assert.equal(rule?.severity, 'medium');
  assert.equal(rule?.category, 'remotion_lifecycle');
  assert.match(rule?.recommendation ?? '', /secondsToFrames|createDurationTimeline/);
  assert.match(rule?.repairHint ?? '', /secondsToFrames/);
});

test('public security policy exposes a stable release-cohort digest', () => {
  assert.match(
    PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    /^component-security-policy-digest\.v0\.1:[a-f0-9]{16}$/,
  );
  assert.equal(
    PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    createPromptFramePublicSecurityPolicyDigest(PROMPTFRAME_PUBLIC_SECURITY_POLICY),
  );

  const mutatedPolicy = {
    ...PROMPTFRAME_PUBLIC_SECURITY_POLICY,
    forbiddenApis: [
      {
        ...PROMPTFRAME_PUBLIC_SECURITY_POLICY.forbiddenApis[0],
        id: 'code.eval.changed',
      },
      ...PROMPTFRAME_PUBLIC_SECURITY_POLICY.forbiddenApis.slice(1),
    ],
  };
  assert.notEqual(
    createPromptFramePublicSecurityPolicyDigest(mutatedPolicy),
    PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
  );
  assert.equal(COMPONENT_SECURITY_POLICY_DIGEST_VERSION, 'component-security-policy-digest.v0.1');
});
