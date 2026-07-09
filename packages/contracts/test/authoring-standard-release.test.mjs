import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authoringStandardFreshnessDecisionSchema,
  authoringStandardReleaseSchema,
  AUTHORING_STANDARD_RELEASE_VERSION,
  COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
  componentPublicResourceManifestSchema,
  componentRuntimeResourceManifestSchema,
  COMPONENT_STANDARD_SOURCE_HASH,
  COMPONENT_STANDARD_VERSION,
  PROMPTFRAME_AUTHORING_STANDARD_RELEASE,
  PROMPTFRAME_PUBLIC_RESOURCE_POLICY,
} from '../dist/index.js';

test('authoring standard release exposes upload targets and package floors', () => {
  const release = authoringStandardReleaseSchema.parse(PROMPTFRAME_AUTHORING_STANDARD_RELEASE);

  assert.equal(release.releaseVersion, AUTHORING_STANDARD_RELEASE_VERSION);
  assert.equal(release.standardVersion, COMPONENT_STANDARD_VERSION);
  assert.equal(release.standardSourceHash, COMPONENT_STANDARD_SOURCE_HASH);
  assert.deepEqual(release.uploadTargets.map((target) => target.target), [
    'marketplace_authoring',
    'project_private_generation',
  ]);
  assert.equal(release.uploadTargets[0].requiresHumanPublishApproval, true);
  assert.equal(release.uploadTargets[1].requiresHumanPublishApproval, false);
  assert.deepEqual(release.minPackageVersions, {
    contracts: '0.1.20',
    componentKit: '0.1.16',
    cli: '0.1.51',
    createComponent: '0.1.42',
  });
  assert.deepEqual(release.scaffoldTemplates, [
    {
      name: 'react-remotion',
      digest: 'sha256:4de0df168bcf85bf88e396d23f2ef66266ff8dc64f3c3d992ebd448d84d04dec',
    },
  ]);
});

test('freshness decision keeps local and current standard fingerprints separate', () => {
  const decision = authoringStandardFreshnessDecisionSchema.parse({
    status: 'upload_blocking',
    target: 'marketplace_authoring',
    localStandardVersion: 'component-standard.v0.0.9',
    localStandardSourceHash: `sha256:${'0'.repeat(64)}`,
    currentStandardVersion: COMPONENT_STANDARD_VERSION,
    currentStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    minPackageVersions: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions,
    diagnostic: {
      code: 'standard.freshness.upload_blocking',
      severity: 'error',
      message: 'Local authoring standard is stale.',
    },
    retryable: false,
  });

  assert.equal(decision.status, 'upload_blocking');
  assert.notEqual(decision.localStandardSourceHash, decision.currentStandardSourceHash);
  assert.equal(decision.diagnostic.code, 'standard.freshness.upload_blocking');
});

test('public resource policy and schemas describe component public assets', () => {
  assert.equal(PROMPTFRAME_PUBLIC_RESOURCE_POLICY.contractVersion, COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION);
  assert.ok(PROMPTFRAME_PUBLIC_RESOURCE_POLICY.allowedExtensions.image.includes('.png'));
  assert.ok(PROMPTFRAME_PUBLIC_RESOURCE_POLICY.allowedExtensions.font.includes('.woff2'));
  assert.equal(PROMPTFRAME_PUBLIC_RESOURCE_POLICY.runtime.injectedProp, 'promptFrameResources');

  const manifest = componentPublicResourceManifestSchema.parse({
    contractVersion: COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
    basePath: '/',
    entries: [
      {
        publicPath: '/logo.png',
        sourcePath: 'public/logo.png',
        artifactPath: 'resources/public/logo.png',
        kind: 'image',
        contentType: 'image/png',
        sizeBytes: 12,
        sha256: `sha256:${'a'.repeat(64)}`,
      },
    ],
    totalBytes: 12,
    generatedAt: '2026-06-13T00:00:00.000Z',
  });

  const runtime = componentRuntimeResourceManifestSchema.parse({
    contractVersion: COMPONENT_PUBLIC_RESOURCES_CONTRACT_VERSION,
    entries: [
      {
        ...manifest.entries[0],
        url: '/public/component-resources/demo/logo.png',
      },
    ],
  });

  assert.equal(manifest.entries[0].publicPath, '/logo.png');
  assert.equal(runtime.entries[0].url, '/public/component-resources/demo/logo.png');
  assert.throws(() => componentPublicResourceManifestSchema.parse({
    ...manifest,
    entries: [{ ...manifest.entries[0], publicPath: '/../secret.png' }],
  }));
});
