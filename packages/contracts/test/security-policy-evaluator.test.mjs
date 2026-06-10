import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
  evaluatePromptFrameSecurityPolicySource,
} from '../dist/security-policy-evaluator.js';

function ruleIdsFor(source, file = 'src/Component.tsx') {
  return evaluatePromptFrameSecurityPolicySource({ file, source }).findings.map((finding) => finding.ruleId);
}

test('AST evaluator detects direct and aliased forbidden browser globals', () => {
  const source = `
    const Direct = new BroadcastChannel('preview');
    const BC = BroadcastChannel;
    new BC('render');
    const { BroadcastChannel: FromGlobal } = globalThis;
    new FromGlobal('global');
  `;

  assert.ok(ruleIdsFor(source).includes('browser.broadcast_channel'));
});

test('AST evaluator detects member access browser capabilities', () => {
  const source = `
    window['BroadcastChannel']('preview');
    navigator.serviceWorker.register('/sw.js');
    navigator.clipboard.writeText('x');
  `;
  const ruleIds = ruleIdsFor(source);

  assert.ok(ruleIds.includes('browser.broadcast_channel'));
  assert.ok(ruleIds.includes('browser.service_worker'));
  assert.ok(ruleIds.includes('browser.clipboard'));
});

test('AST evaluator detects dynamic import and string timers', () => {
  const source = `
    import(userSuppliedModule);
    setTimeout("alert(1)", 10);
    setInterval('console.log(1)', 100);
  `;
  const ruleIds = ruleIdsFor(source);

  assert.ok(ruleIds.includes('code.dynamic_import'));
  assert.ok(ruleIds.includes('code.string_timer'));
});

test('AST evaluator avoids comments, strings and harmless local symbols', () => {
  const source = `
    // new BroadcastChannel('not real')
    const text = "navigator.serviceWorker.register('/not-real')";
    const BroadcastChannel = 'label only';
    const serviceWorker = { register: () => 'local' };
    serviceWorker.register();
  `;

  assert.deepEqual(ruleIdsFor(source), []);
});

test('AST evaluator returns digest and source location metadata', () => {
  const [finding] = evaluatePromptFrameSecurityPolicySource({
    file: 'src/Component.tsx',
    source: `new BroadcastChannel('x');`,
  }).findings;

  assert.equal(finding.ruleId, 'browser.broadcast_channel');
  assert.equal(finding.policyDigest, PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST);
  assert.equal(finding.detectionKind, 'ast');
  assert.equal(finding.confidence, 'high');
  assert.equal(finding.file, 'src/Component.tsx');
  assert.equal(finding.line, 1);
  assert.equal(finding.column, 1);
  assert.ok(finding.evidence?.includes('BroadcastChannel'));
});
