import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPONENT_DEPENDENCY_POLICY_VERSION,
  PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY,
  evaluatePromptFrameDependencyPolicy,
} from '../dist/index.js';

test('dependency policy allows reviewed dependencies when a lockfile exists', () => {
  const receipt = evaluatePromptFrameDependencyPolicy({
    packageJson: {
      dependencies: {
        react: '^19.1.0',
        remotion: '^4.0.320',
        three: '^0.177.0',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.19',
      },
    },
    lockfilePresent: true,
  });

  assert.equal(PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY.policyVersion, COMPONENT_DEPENDENCY_POLICY_VERSION);
  assert.equal(receipt.status, 'allow');
  assert.equal(receipt.lane, 'reviewed_visual');
  assert.equal(receipt.publicSearchableAllowed, true);
  assert.equal(receipt.quarantine, false);
  assert.deepEqual(receipt.sandboxInstall.requiredFlags, ['--ignore-scripts', '--frozen-lockfile']);
});

test('dependency policy rejects install scripts and native/prebuild signals', () => {
  const receipt = evaluatePromptFrameDependencyPolicy({
    packageJson: {
      scripts: {
        postinstall: 'node scripts/install.js',
        build: 'node-gyp rebuild',
      },
      dependencies: {
        'prebuild-install': '7.1.2',
      },
    },
    lockfilePresent: true,
  });

  assert.equal(receipt.status, 'reject');
  assert.equal(receipt.lane, 'native_or_scripted');
  assert.equal(receipt.publicSearchableAllowed, false);
  assert.ok(receipt.diagnostics.some((item) => item.code === 'dependency.install.script_forbidden'));
  assert.ok(receipt.diagnostics.some((item) => item.code === 'dependency.install.native_forbidden'));
});

test('dependency policy quarantines unknown dependencies and rejects missing locks', () => {
  const unknown = evaluatePromptFrameDependencyPolicy({
    packageJson: {
      dependencies: {
        '@unknown/visual-engine': '1.2.3',
      },
    },
    lockfilePresent: true,
  });
  assert.equal(unknown.status, 'manual_review');
  assert.equal(unknown.lane, 'requested_dependency');
  assert.equal(unknown.quarantine, true);
  assert.equal(unknown.publicSearchableAllowed, false);
  assert.ok(unknown.diagnostics.some((item) => item.code === 'dependency.catalog.unknown_dependency'));

  const unlocked = evaluatePromptFrameDependencyPolicy({
    packageJson: {
      dependencies: {
        react: '^19.1.0',
      },
    },
    lockfilePresent: false,
  });
  assert.equal(unlocked.status, 'reject');
  assert.equal(unlocked.lane, 'unknown_unlocked');
  assert.ok(unlocked.diagnostics.some((item) => item.code === 'dependency.install.lockfile_required'));
});
