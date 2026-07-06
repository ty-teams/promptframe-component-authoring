import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  PROMPTFRAME_PUBLIC_SECURITY_POLICY,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
} from '@promptframe/contracts';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('dist/index.js');

test('status resolves endpoint from local config and returns platform payload JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-status-'));
  const server = await createServer(async (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/components/marketplace/builds/build-123');
    assert.equal(req.headers['x-tenant-id'], 'tenant-a');
    writeJson(res, {
      success: true,
      build: {
        buildId: 'build-123',
        status: 'succeeded',
        statusUrl: '/admin/components/builds/build-123',
        diagnostics: [{ code: 'component_market.build.succeeded', severity: 'info', message: 'ready' }],
      },
    });
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: server.url,
      tenantId: 'tenant-a',
    }));
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'status',
      'build-123',
      '--json',
      '--config',
      configPath,
    ]);
    const payload = JSON.parse(stdout);
    assert.equal(payload.success, true);
    assert.equal(payload.build.status, 'succeeded');
    assert.equal(payload.command, 'status');
    assert.equal(payload.endpoint, server.url);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('status fail-on-build-failed gates failed platform builds without changing default read-only status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-status-gate-'));
  const server = await createServer(async (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/components/marketplace/builds/build-failed');
    writeJson(res, {
      success: true,
      build: {
        buildId: 'build-failed',
        status: 'failed',
        diagnostics: [{
          code: 'component_market.build.preview_failed',
          severity: 'error',
          message: 'preview probe failed',
        }],
      },
    });
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({ endpoint: server.url }));

    const readOnly = await execFileAsync('node', [
      cliPath,
      'status',
      'build-failed',
      '--json',
      '--config',
      configPath,
    ]);
    const readOnlyPayload = JSON.parse(readOnly.stdout);
    assert.equal(readOnlyPayload.build.status, 'failed');

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'status',
        'build-failed',
        '--json',
        '--fail-on-build-failed',
        '--config',
        configPath,
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).build.status, 'failed');
        assert.match(error.stderr, /status\.build\.failed/);
        assert.match(error.stderr, /component_market\.build\.preview_failed/);
        return true;
      },
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing endpoint emits a stable diagnostic code and nonzero exit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-missing-endpoint-'));
  try {
    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'status',
        'build-123',
        '--config',
        path.join(dir, 'missing.json'),
      ], {
        env: {
          ...process.env,
          PROMPTFRAME_API_BASE: '',
          REMOTION_MEDIA_API_BASE: '',
        },
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /status\.endpoint\.missing/);
        assert.match(error.stderr, /No default production endpoint/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload, probe, and reindex call platform transport paths with stable JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-transport-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({ method: req.method, url: req.url, body });
    if (req.url === '/components/standard') {
      assert.equal(req.method, 'GET');
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers['x-promptframe-upload-target'], 'project_private_generation');
      assert.equal(req.headers['x-promptframe-version-notes'], 'Initial visual polish');
      assert.equal(req.headers['x-promptframe-security-policy-version'], PROMPTFRAME_PUBLIC_SECURITY_POLICY.policyVersion);
      assert.equal(req.headers['x-promptframe-security-policy-digest'], PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST);
      assert.equal(req.headers['x-promptframe-security-evaluator-mode'], 'ast');
      assert.match(body.toString('latin1'), /fake component zip/);
      writeJson(res, { success: true, jobId: 'build-uploaded', status: 'queued' });
      return;
    }
    if (req.url === '/components/marketplace/builds/build-uploaded/probes/run') {
      assert.equal(req.method, 'POST');
      assert.deepEqual(JSON.parse(body.toString('utf8')), { level: 'standard' });
      writeJson(res, { success: true, probe: { level: 'standard', status: 'ready', diagnostics: [] } });
      return;
    }
    if (req.url === '/components/marketplace/builds/build-uploaded/evidence/reindex') {
      assert.equal(req.method, 'POST');
      assert.deepEqual(JSON.parse(body.toString('utf8')), { providerKind: 'cloud_embedding' });
      writeJson(res, { success: true, evidence: [], providers: [] });
      return;
    }
    res.statusCode = 404;
    writeJson(res, { success: false, error: `unexpected ${req.method} ${req.url}` });
  });
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    const upload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      zipPath,
      '--endpoint',
      server.url,
      '--target',
      'project_private_generation',
      '--release-notes',
      'Initial visual polish',
      '--json',
    ])).stdout);
    assert.equal(upload.command, 'upload');
    assert.equal(upload.jobId, 'build-uploaded');
    assert.equal(upload.versionNotes, 'Initial visual polish');
    assert.equal(upload.diagnostic.code, 'upload.completed');

    const probe = JSON.parse((await execFileAsync('node', [
      cliPath,
      'probe',
      'build-uploaded',
      '--endpoint',
      server.url,
      '--level',
      'standard',
      '--json',
    ])).stdout);
    assert.equal(probe.command, 'probe');
    assert.equal(probe.probe.status, 'ready');
    assert.equal(probe.diagnostic.code, 'probe.completed');

    const reindex = JSON.parse((await execFileAsync('node', [
      cliPath,
      'reindex',
      'build-uploaded',
      '--endpoint',
      server.url,
      '--provider-kind',
      'cloud_embedding',
      '--json',
    ])).stdout);
    assert.equal(reindex.command, 'reindex');
    assert.equal(reindex.success, true);
    assert.equal(reindex.diagnostic.code, 'reindex.completed');
    assert.deepEqual(calls.map((call) => call.url), [
      '/components/standard',
      '/components/marketplace/upload',
      '/components/marketplace/builds/build-uploaded/probes/run',
      '/components/marketplace/builds/build-uploaded/evidence/reindex',
    ]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload forwards sanitized version notes from environment fallback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-version-notes-env-'));
  const expectedNotes = 'Release heading second line with spacing';
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers['x-promptframe-version-notes'], expectedNotes);
      assert.match(body.toString('latin1'), /fake component zip/);
      writeJson(res, { success: true, jobId: 'build-uploaded', status: 'queued' });
      return;
    }
    res.statusCode = 404;
    writeJson(res, { success: false, error: `unexpected ${req.method} ${req.url}` });
  });
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    const upload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      zipPath,
      '--endpoint',
      server.url,
      '--target',
      'project_private_generation',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_VERSION_NOTES: 'Release heading\nsecond line   with   spacing',
      },
    })).stdout);
    assert.equal(upload.command, 'upload');
    assert.equal(upload.versionNotes, expectedNotes);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('remote commands forward optional dev auth headers without defaulting production auth', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-auth-headers-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({
      method: req.method,
      url: req.url,
      roles: req.headers['x-auth-roles'],
      permissions: req.headers['x-auth-permissions'],
      body,
    });
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      writeJson(res, { success: true, jobId: 'build-auth', status: 'queued' });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    const upload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      zipPath,
      '--endpoint',
      server.url,
      '--target',
      'project_private_generation',
      '--auth-roles',
      'tenant_admin,marketplace_admin',
      '--auth-permissions',
      'component:marketplace:write,component:marketplace:review',
      '--json',
    ])).stdout);

    assert.equal(upload.jobId, 'build-auth');
    assert.deepEqual(calls.map((call) => call.url), ['/components/standard', '/components/marketplace/upload']);
    for (const call of calls) {
      assert.equal(call.roles, 'tenant_admin,marketplace_admin');
      assert.equal(call.permissions, 'component:marketplace:write,component:marketplace:review');
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('login verifies a bearer token, stores a 0600 local credential, and never prints the token secret', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-login-token-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (req.url === '/cli/auth/whoami') {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, 'Bearer pf_human_secret_once');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_human',
        tokenKind: 'human',
        principal: {
          tenantId: 'tenant-a',
          userId: 'user-a',
          projectId: 'project-a',
          displayIdentifier: 'user@example.com',
          permissions: ['component:marketplace:read'],
        },
        scopes: ['component.status.read'],
        expiresAt: '2099-06-10T00:00:00.000Z',
        revoked: false,
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'login',
      '--endpoint',
      server.url,
      '--token',
      'pf_human_secret_once',
      '--config',
      configPath,
      '--json',
    ]);
    assert.doesNotMatch(stdout, /pf_human_secret_once/);
    const payload = JSON.parse(stdout);
    assert.equal(payload.command, 'login');
    assert.equal(payload.diagnostic.code, 'login.completed');
    assert.equal(payload.credential.tokenId, 'cli_token_human');
    assert.equal(payload.credential.displayIdentifier, 'user@example.com');
    assert.equal(payload.credential.tokenSecret, undefined);
    assert.equal(payload.storage.diagnostic.code, 'cli.auth.file_credential_warning');
    assert.deepEqual(calls.map((call) => call.url), ['/cli/auth/whoami']);

    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(saved.endpoint, server.url);
    assert.equal(saved.credential.tokenSecret, 'pf_human_secret_once');
    assert.equal(saved.credential.endpoint, server.url);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('login completes browser device code flow without printing the token secret', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-login-device-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({
      method: req.method,
      url: req.url,
      body: body.length > 0 ? JSON.parse(body.toString('utf8')) : undefined,
    });
    if (req.url === '/cli/auth/device/start') {
      assert.equal(req.method, 'POST');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        deviceCode: 'device-123',
        userCode: 'PF-1234',
        verificationUri: `${server.url}/cli/device`,
        verificationUriComplete: `${server.url}/cli/device?user_code=PF-1234`,
        expiresAt: '2099-06-09T00:10:00.000Z',
        intervalSeconds: 1,
      }, 201);
      return;
    }
    if (req.url === '/cli/auth/device/poll') {
      assert.equal(req.method, 'POST');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        status: 'approved',
        credential: {
          contractVersion: 'cli-auth.v0.1.0',
          endpoint: server.url,
          tokenId: 'cli_token_device',
          tokenKind: 'human',
          displayIdentifier: 'author@example.com',
          tenantId: 'tenant-a',
          projectId: 'project-a',
          expiresAt: '2099-07-09T00:00:00.000Z',
          tokenSecret: 'pf_cli_secret_from_poll',
        },
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'login',
      '--endpoint',
      server.url,
      '--config',
      configPath,
      '--poll-interval-seconds',
      '1',
      '--timeout-seconds',
      '2',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_CLI_TOKEN: '',
        PROMPTFRAME_CI_TOKEN: '',
      },
    });
    assert.doesNotMatch(stdout, /pf_cli_secret_from_poll/);
    const payload = JSON.parse(stdout);
    assert.equal(payload.command, 'login');
    assert.equal(payload.credential.tokenId, 'cli_token_device');
    assert.equal(payload.credential.tokenSecret, undefined);
    assert.equal(payload.device.userCode, 'PF-1234');
    assert.deepEqual(calls.map((call) => call.url), [
      '/cli/auth/device/start',
      '/cli/auth/device/poll',
    ]);

    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(saved.endpoint, server.url);
    assert.equal(saved.credential.tokenSecret, 'pf_cli_secret_from_poll');
    assert.equal(saved.credential.endpoint, server.url);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('whoami uses the stored matching endpoint credential as a bearer token', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-whoami-token-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      tenantId: req.headers['x-tenant-id'],
      userId: req.headers['x-user-id'],
      roles: req.headers['x-auth-roles'],
    });
    if (req.url === '/cli/auth/whoami') {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, 'Bearer pf_stored_secret');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_stored',
        tokenKind: 'human',
        principal: {
          tenantId: 'tenant-a',
          userId: 'user-a',
          projectId: 'project-a',
          permissions: ['component:marketplace:read'],
        },
        scopes: ['component.status.read'],
        expiresAt: '2099-06-10T00:00:00.000Z',
        revoked: false,
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: server.url,
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_stored',
        tokenKind: 'human',
        displayIdentifier: 'user@example.com',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_stored_secret',
      },
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'whoami',
      '--config',
      configPath,
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'whoami');
    assert.equal(payload.tokenId, 'cli_token_stored');
    assert.equal(payload.principal.tenantId, 'tenant-a');
    assert.equal(payload.diagnostic.code, 'whoami.completed');
    assert.equal(payload.tokenSecret, undefined);
    assert.deepEqual(calls, [{
      method: 'GET',
      url: '/cli/auth/whoami',
      authorization: 'Bearer pf_stored_secret',
      tenantId: undefined,
      userId: undefined,
      roles: undefined,
    }]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('logout revokes the current bearer token and clears the stored credential', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-logout-token-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (req.url === '/cli/auth/logout') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.authorization, 'Bearer pf_logout_secret');
      writeJson(res, {
        success: true,
        token: {
          tokenId: 'cli_token_logout',
          revokedAt: '2026-06-09T00:00:00.000Z',
        },
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: server.url,
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_logout',
        tokenKind: 'human',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_logout_secret',
      },
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'logout',
      '--config',
      configPath,
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'logout');
    assert.equal(payload.diagnostic.code, 'logout.completed');
    assert.equal(payload.clearedLocalCredential, true);
    assert.equal(payload.token.tokenId, 'cli_token_logout');
    assert.doesNotMatch(JSON.stringify(payload), /pf_logout_secret/);
    assert.deepEqual(calls.map((call) => call.url), ['/cli/auth/logout']);
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(saved.endpoint, server.url);
    assert.equal(saved.credential, undefined);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('whoami without a bearer credential emits a stable login-required diagnostic', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-whoami-missing-token-'));
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: 'https://promptframe.example/api-proxy',
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'whoami',
        '--config',
        configPath,
        '--json',
      ], {
        env: {
          ...process.env,
          PROMPTFRAME_CI_TOKEN: '',
          PROMPTFRAME_CLI_TOKEN: '',
        },
      }),
      (error) => {
        assert.equal(error.code, 2);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'whoami');
        assert.equal(payload.diagnostic.code, 'cli.auth.login_required');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discovery and project commands fetch self-service context without owner overrides', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-discovery-projects-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      tenantId: req.headers['x-tenant-id'],
      userId: req.headers['x-user-id'],
      projectId: req.headers['x-project-id'],
    });
    if (req.url === '/cli/discovery') {
      assert.equal(req.method, 'GET');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        endpointProfile: 'local',
        authRequired: true,
        projectDiscoveryRequiresAuth: true,
        selfCiTokensSupported: true,
        uploadTargets: ['marketplace_authoring', 'project_private_generation'],
      });
      return;
    }
    if (req.url === '/cli/projects') {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        currentProjectId: 'project-a',
        selectionRequired: false,
        projects: [
          {
            tenantId: 'tenant-a',
            projectId: 'project-a',
            name: 'Project A',
            visibility: 'shared',
            role: 'editor',
            source: 'invite',
            status: 'active',
            isCurrent: true,
          },
        ],
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: server.url,
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_self',
        tokenKind: 'human',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_self_secret',
      },
    }, null, 2));

    const discovery = JSON.parse((await execFileAsync('node', [
      cliPath,
      'discovery',
      '--config',
      configPath,
      '--json',
    ])).stdout);
    assert.equal(discovery.command, 'discovery');
    assert.equal(discovery.endpoint, server.url);
    assert.equal(discovery.selfCiTokensSupported, true);
    assert.deepEqual(discovery.uploadTargets, ['marketplace_authoring', 'project_private_generation']);
    assert.equal(discovery.diagnostic.code, 'discovery.completed');

    const list = JSON.parse((await execFileAsync('node', [
      cliPath,
      'project',
      'list',
      '--config',
      configPath,
      '--json',
    ])).stdout);
    assert.equal(list.command, 'project.list');
    assert.equal(list.currentProjectId, 'project-a');
    assert.equal(list.projects[0].projectId, 'project-a');
    assert.equal(list.projects[0].isCurrent, true);

    const current = JSON.parse((await execFileAsync('node', [
      cliPath,
      'project',
      'current',
      '--config',
      configPath,
      '--json',
    ])).stdout);
    assert.equal(current.command, 'project.current');
    assert.equal(current.currentProject.projectId, 'project-a');

    assert.equal(JSON.stringify(discovery).includes('pf_self_secret'), false);
    assert.equal(JSON.stringify(list).includes('pf_self_secret'), false);
    assert.equal(JSON.stringify(current).includes('pf_self_secret'), false);
    for (const call of calls) {
      assert.equal(call.tenantId, undefined);
      assert.equal(call.userId, undefined);
      assert.equal(call.projectId, undefined);
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('init writes a secret-free promptframe project context from current project', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-project-context-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      tenantId: req.headers['x-tenant-id'],
      userId: req.headers['x-user-id'],
      projectId: req.headers['x-project-id'],
    });
    if (req.url === '/cli/projects') {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        currentProjectId: 'project-a',
        selectionRequired: false,
        projects: [
          {
            tenantId: 'tenant-a',
            projectId: 'project-a',
            projectNamespace: 'project-a',
            name: 'Project A',
            visibility: 'shared',
            role: 'editor',
            source: 'invite',
            status: 'active',
            isCurrent: true,
          },
        ],
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_self',
        tokenKind: 'human',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_self_secret',
      },
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'init',
      dir,
      '--endpoint',
      server.url,
      '--config',
      configPath,
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'init');
    assert.equal(payload.contextPath, path.join(dir, '.promptframerc'));
    assert.equal(payload.project.projectId, 'project-a');
    assert.equal(payload.diagnostic.code, 'project_context.init.completed');

    const promptframeRc = JSON.parse(await readFile(path.join(dir, '.promptframerc'), 'utf8'));
    assert.deepEqual(promptframeRc, {
      schemaVersion: 'promptframe-project-context.v0.1.0',
      endpoint: server.url,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      projectNamespace: 'project-a',
      defaultUploadTarget: 'marketplace_authoring',
      workspaceConfig: 'promptframe-workspace.json',
    });
    assert.equal(JSON.stringify(promptframeRc).includes('pf_self_secret'), false);
    assert.equal(JSON.stringify(promptframeRc).includes('tokenSecret'), false);
    for (const call of calls) {
      assert.equal(call.tenantId, undefined);
      assert.equal(call.userId, undefined);
      assert.equal(call.projectId, undefined);
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('component commands use promptframerc endpoint and avoid owner override fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-component-commands-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      tenantId: req.headers['x-tenant-id'],
      userId: req.headers['x-user-id'],
      projectId: req.headers['x-project-id'],
      body,
    });
    if (req.url === '/components/marketplace/self/components' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      const payload = JSON.parse(body.toString('utf8'));
      assert.deepEqual(payload, {
        componentId: '@project-a/hero-panel',
        displayName: 'Hero Panel',
        description: 'Reusable hero panel for launch videos.',
      });
      writeJson(res, {
        success: true,
        declaration: {
          contractVersion: 'component-project-registry.v0.1.0',
          tenantId: 'tenant-a',
          projectId: 'project-a',
          userId: 'user-a',
          projectNamespace: 'project-a',
          componentId: '@project-a/hero-panel',
          componentSlug: 'hero-panel',
          displayName: 'Hero Panel',
          description: 'Reusable hero panel for launch videos.',
          status: 'declared',
          createdAt: '2026-06-17T00:00:00.000Z',
          updatedAt: '2026-06-17T00:00:00.000Z',
        },
      }, 201);
      return;
    }
    if (req.url === '/components/marketplace/self/components' && req.method === 'GET') {
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      writeJson(res, {
        success: true,
        declarations: [
          {
            contractVersion: 'component-project-registry.v0.1.0',
            tenantId: 'tenant-a',
            projectId: 'project-a',
            userId: 'user-a',
            projectNamespace: 'project-a',
            componentId: '@project-a/hero-panel',
            componentSlug: 'hero-panel',
            displayName: 'Hero Panel',
            status: 'declared',
            createdAt: '2026-06-17T00:00:00.000Z',
            updatedAt: '2026-06-17T00:00:00.000Z',
          },
        ],
        components: [],
        items: [],
        builds: [],
        page: {
          cursor: null,
          nextCursor: null,
          hasNextPage: false,
          pageSize: 25,
          totalCount: 0,
        },
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.method} ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_self',
        tokenKind: 'human',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_self_secret',
      },
    }, null, 2));
    await writeFile(path.join(dir, '.promptframerc'), JSON.stringify({
      schemaVersion: 'promptframe-project-context.v0.1.0',
      endpoint: server.url,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      projectNamespace: 'project-a',
      defaultUploadTarget: 'marketplace_authoring',
      workspaceConfig: 'promptframe-workspace.json',
    }, null, 2));

    const created = JSON.parse((await execFileAsync('node', [
      cliPath,
      'component',
      'create',
      '@project-a/hero-panel',
      '--display-name',
      'Hero Panel',
      '--description',
      'Reusable hero panel for launch videos.',
      '--config',
      configPath,
      '--json',
    ], { cwd: dir })).stdout);
    assert.equal(created.command, 'component.create');
    assert.equal(created.endpoint, server.url);
    assert.equal(created.declaration.componentId, '@project-a/hero-panel');
    assert.equal(JSON.stringify(created).includes('pf_self_secret'), false);

    const listed = JSON.parse((await execFileAsync('node', [
      cliPath,
      'component',
      'list',
      '--config',
      configPath,
      '--json',
    ], { cwd: dir })).stdout);
    assert.equal(listed.command, 'component.list');
    assert.equal(listed.endpoint, server.url);
    assert.deepEqual(listed.declarations.map((item) => item.componentId), ['@project-a/hero-panel']);
    assert.equal(JSON.stringify(listed).includes('pf_self_secret'), false);

    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'POST /components/marketplace/self/components',
      'GET /components/marketplace/self/components',
    ]);
    for (const call of calls) {
      assert.equal(call.tenantId, undefined);
      assert.equal(call.userId, undefined);
      assert.equal(call.projectId, undefined);
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('component commands reject secret-bearing promptframe project context', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-project-context-secret-'));
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: 'http://127.0.0.1:9/api-proxy',
        tokenId: 'cli_token_self',
        tokenKind: 'human',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_self_secret',
      },
    }, null, 2));
    await writeFile(path.join(dir, '.promptframerc'), JSON.stringify({
      schemaVersion: 'promptframe-project-context.v0.1.0',
      endpoint: 'http://127.0.0.1:9/api-proxy',
      projectId: 'project-a',
      projectNamespace: 'project-a',
      tokenSecret: 'pf_must_not_live_in_repo',
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'component',
        'list',
        '--config',
        configPath,
        '--json',
      ], { cwd: dir }),
      (error) => {
        assert.equal(error.code, 2);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'component');
        assert.equal(payload.diagnostic.code, 'project_context.secret_field_forbidden');
        assert.match(payload.failureReason, /tokenSecret/);
        assert.equal(payload.failureReason.includes('pf_must_not_live_in_repo'), false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ci-token self-service commands create list and revoke without owner override fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-self-ci-token-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body,
    });
    if (req.url === '/cli/tokens/self' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      const payload = JSON.parse(body.toString('utf8'));
      assert.equal(payload.name, 'GitHub release');
      assert.deepEqual(payload.scopes, ['component.upload', 'component.status.read']);
      assert.deepEqual(payload.allowedUploadTargets, ['marketplace_authoring']);
      assert.equal(payload.tenantId, undefined);
      assert.equal(payload.projectId, undefined);
      assert.equal(payload.userId, undefined);
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        token: {
          contractVersion: 'cli-auth.v0.1.0',
          tokenId: 'ci_token_self',
          tokenKind: 'ci',
          name: 'GitHub release',
          endpoint: server.url,
          endpointProfile: 'local',
          tenantId: 'tenant-a',
          projectId: 'project-a',
          createdByUserId: 'user-a',
          scopes: ['component.upload', 'component.status.read'],
          allowedUploadTargets: ['marketplace_authoring'],
          expiresAt: '2099-07-01T00:00:00.000Z',
          createdReason: 'release automation',
          createdAt: '2026-06-14T00:00:00.000Z',
        },
        tokenSecret: 'pf_ci_secret_once',
      }, 201);
      return;
    }
    if (req.url === '/cli/tokens/self?status=active' && req.method === 'GET') {
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      writeJson(res, {
        contractVersion: 'cli-auth.v0.1.0',
        items: [
          {
            contractVersion: 'cli-auth.v0.1.0',
            tokenId: 'ci_token_self',
            tokenKind: 'ci',
            name: 'GitHub release',
            endpoint: server.url,
            endpointProfile: 'local',
            tenantId: 'tenant-a',
            projectId: 'project-a',
            createdByUserId: 'user-a',
            scopes: ['component.upload'],
            allowedUploadTargets: ['marketplace_authoring'],
            expiresAt: '2099-07-01T00:00:00.000Z',
            createdReason: 'release automation',
            createdAt: '2026-06-14T00:00:00.000Z',
          },
        ],
        tokens: [],
        page: {
          cursor: null,
          nextCursor: null,
          hasNextPage: false,
          pageSize: 25,
          totalCount: 1,
        },
        filtersApplied: { status: 'active' },
      });
      return;
    }
    if (req.url === '/cli/tokens/self/ci_token_self/revoke' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer pf_self_secret');
      assert.deepEqual(JSON.parse(body.toString('utf8')), {
        contractVersion: 'cli-auth.v0.1.0',
        reason: 'rotate release credential',
      });
      writeJson(res, {
        success: true,
        token: {
          contractVersion: 'cli-auth.v0.1.0',
          tokenId: 'ci_token_self',
          tokenKind: 'ci',
          name: 'GitHub release',
          endpoint: server.url,
          endpointProfile: 'local',
          tenantId: 'tenant-a',
          projectId: 'project-a',
          createdByUserId: 'user-a',
          scopes: ['component.upload'],
          allowedUploadTargets: ['marketplace_authoring'],
          expiresAt: '2099-07-01T00:00:00.000Z',
          createdReason: 'release automation',
          createdAt: '2026-06-14T00:00:00.000Z',
          revokedAt: '2026-06-14T00:10:00.000Z',
        },
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.method} ${req.url}` }, 404);
  });
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: server.url,
      credential: {
        contractVersion: 'cli-auth.v0.1.0',
        endpoint: server.url,
        tokenId: 'cli_token_self',
        tokenKind: 'human',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        expiresAt: '2099-06-10T00:00:00.000Z',
        tokenSecret: 'pf_self_secret',
      },
    }, null, 2));

    const created = JSON.parse((await execFileAsync('node', [
      cliPath,
      'ci-token',
      'create',
      '--name',
      'GitHub release',
      '--scope',
      'component.upload',
      '--scope',
      'component.status.read',
      '--upload-target',
      'marketplace_authoring',
      '--expires-at',
      '2099-07-01T00:00:00.000Z',
      '--reason',
      'release automation',
      '--config',
      configPath,
      '--json',
    ])).stdout);
    assert.equal(created.command, 'ci-token.create');
    assert.equal(created.token.tokenId, 'ci_token_self');
    assert.equal(created.tokenSecret, 'pf_ci_secret_once');

    const list = JSON.parse((await execFileAsync('node', [
      cliPath,
      'ci-token',
      'list',
      '--status',
      'active',
      '--config',
      configPath,
      '--json',
    ])).stdout);
    assert.equal(list.command, 'ci-token.list');
    assert.equal(list.items[0].tokenId, 'ci_token_self');
    assert.equal(JSON.stringify(list).includes('pf_ci_secret_once'), false);

    const revoked = JSON.parse((await execFileAsync('node', [
      cliPath,
      'ci-token',
      'revoke',
      'ci_token_self',
      '--reason',
      'rotate release credential',
      '--config',
      configPath,
      '--json',
    ])).stdout);
    assert.equal(revoked.command, 'ci-token.revoke');
    assert.equal(revoked.token.revokedAt, '2026-06-14T00:10:00.000Z');
    assert.equal(JSON.stringify(revoked).includes('pf_ci_secret_once'), false);

    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'POST /cli/tokens/self',
      'GET /cli/tokens/self?status=active',
      'POST /cli/tokens/self/ci_token_self/revoke',
    ]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('formal endpoints reject dev-header auth before remote transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-formal-dev-header-'));
  try {
    const configPath = path.join(dir, 'promptframe-config.json');
    await writeFile(configPath, JSON.stringify({
      endpoint: 'https://promptframe.example/api-proxy',
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'status',
        'build-123',
        '--config',
        configPath,
        '--auth-roles',
        'tenant_admin',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'status');
        assert.equal(payload.diagnostic.code, 'cli.auth.dev_header_formal_endpoint_forbidden');
        assert.match(payload.failureReason, /promptframe login --endpoint https:\/\/promptframe\.example\/api-proxy/);
        assert.match(payload.failureReason, /PROMPTFRAME_CI_TOKEN/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setup-ci writes a GitHub workflow without embedding endpoint or token secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-setup-ci-'));
  try {
    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'setup-ci',
      dir,
      '--provider',
      'github',
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'setup-ci');
    assert.equal(payload.provider, 'github');
    assert.equal(payload.diagnostic.code, 'setup_ci.github.completed');
    assert.equal(payload.workflowPath, path.join(dir, '.github/workflows/promptframe-component.yml'));
    assert.deepEqual(payload.requiredSecrets, ['PROMPTFRAME_CI_TOKEN']);
    assert.deepEqual(payload.requiredVariables, ['PROMPTFRAME_API_BASE']);

    const workflow = await readFile(payload.workflowPath, 'utf8');
    assert.match(workflow, /# promptframe-workflow-version: 2/);
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /branches: \[main\]/);
    assert.match(workflow, /\$\{\{ secrets\.PROMPTFRAME_CI_TOKEN \}\}/);
    assert.match(workflow, /\$\{\{ vars\.PROMPTFRAME_API_BASE \}\}/);
    assert.match(workflow, /promptframe check \. --json/);
    assert.match(workflow, /PROMPTFRAME_VERSION_NOTES=/);
    assert.match(workflow, /promptframe upload \. --endpoint "\$PROMPTFRAME_API_BASE" --release-notes "\$PROMPTFRAME_VERSION_NOTES" --json/);
    assert.match(workflow, /promptframe status "\$BUILD_ID" --endpoint "\$PROMPTFRAME_API_BASE" --json --fail-on-build-failed/);
    assert.match(workflow, /STATUS_EXIT=\$\{PIPESTATUS\[0\]\}/);
    assert.match(workflow, /::error title=PromptFrame platform build failed::/);
    assert.match(workflow, /exit "\$STATUS_EXIT"/);
    assert.match(workflow, /GITHUB_STEP_SUMMARY/);
    assert.match(workflow, /::warning title=/);
    assert.doesNotMatch(workflow, /pf_(?:ci|human|cli)_[A-Za-z0-9_-]+/);
    assert.doesNotMatch(workflow, /promptframe-beta|tail0fae3a|100\.\d+\.\d+\.\d+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setup-ci detects and upgrades stale managed GitHub workflows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-setup-ci-upgrade-'));
  try {
    const workflowPath = path.join(dir, '.github/workflows/promptframe-component.yml');
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, [
      'name: PromptFrame Component',
      'on: push',
      'jobs: {}',
    ].join('\n'));

    const dryRun = JSON.parse((await execFileAsync('node', [
      cliPath,
      'setup-ci',
      dir,
      '--provider',
      'github',
      '--upgrade',
      '--dry-run',
      '--json',
    ])).stdout);

    assert.equal(dryRun.command, 'setup-ci');
    assert.equal(dryRun.diagnostic.code, 'setup_ci.workflow.upgrade_available');
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.workflow.currentVersion, null);
    assert.equal(dryRun.workflow.latestVersion, 2);
    assert.match(dryRun.workflow.repairCommand, /promptframe setup-ci .* --upgrade/);
    assert.equal(await readFile(workflowPath, 'utf8'), 'name: PromptFrame Component\non: push\njobs: {}');

    const upgraded = JSON.parse((await execFileAsync('node', [
      cliPath,
      'setup-ci',
      dir,
      '--provider',
      'github',
      '--upgrade',
      '--json',
    ])).stdout);

    assert.equal(upgraded.diagnostic.code, 'setup_ci.workflow.upgraded');
    assert.equal(upgraded.workflow.previousVersion, null);
    assert.equal(upgraded.workflow.latestVersion, 2);
    assert.match(await readFile(workflowPath, 'utf8'), /# promptframe-workflow-version: 2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setup-ci --workspace reports version-one workflows as stale before rewriting', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-setup-ci-workspace-upgrade-'));
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/fixture-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));
    const workflowPath = path.join(dir, '.github/workflows/promptframe-workspace.yml');
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, [
      '# promptframe-workflow-version: 1',
      '# Generated by promptframe setup-ci --workspace. Keep this header when editing manually.',
      'name: PromptFrame Component Workspace',
    ].join('\n'));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'setup-ci',
      dir,
      '--provider',
      'github',
      '--workspace',
      '--upgrade',
      '--dry-run',
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'setup-ci');
    assert.equal(payload.workspace, true);
    assert.equal(payload.diagnostic.code, 'setup_ci.workflow.upgrade_available');
    assert.equal(payload.workflow.currentVersion, 1);
    assert.equal(payload.workflow.latestVersion, 2);
    assert.match(payload.workflow.message, /workflow 模板已过期/);
    assert.match(await readFile(workflowPath, 'utf8'), /# promptframe-workflow-version: 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check reports stale PromptFrame workflow templates as actionable diagnostics', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-stale-workflow-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    const workflowPath = path.join(componentDir, '.github/workflows/promptframe-component.yml');
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, [
      '# promptframe-workflow-version: 1',
      '# Generated by promptframe setup-ci. Keep this header when editing manually.',
      'name: PromptFrame Component',
    ].join('\n'));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    })).stdout);

    const workflowDiagnostic = payload.diagnostics.find((item) => item.code === 'setup_ci.workflow.stale');
    assert.equal(workflowDiagnostic.severity, 'warning');
    assert.match(workflowDiagnostic.message, /workflow 模板已过期/);
    assert.match(workflowDiagnostic.repairHint, /promptframe setup-ci .* --upgrade/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace validate reports component paths and manifest IDs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-workspace-'));
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/fixture-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'workspace',
      'validate',
      dir,
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'workspace.validate');
    assert.equal(payload.diagnostic.code, 'workspace.validate.completed');
    assert.equal(payload.workspace.configPath, path.join(dir, 'promptframe-workspace.json'));
    assert.equal(payload.components[0].id, '@demo/fixture-component');
    assert.equal(payload.components[0].path, 'components/motion-intro/image-particle-remotion');
    assert.equal(payload.components[0].manifest.id, '@demo/fixture-component');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace validate reports unresolved workspace shared packages before generic dependency policy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-workspace-shared-missing-'));
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    const packageJson = JSON.parse(await readFile(path.join(componentDir, 'package.json'), 'utf8'));
    packageJson.dependencies['@demo/shared-utils'] = 'workspace:*';
    await writeFile(path.join(componentDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "components/*"\n  - "packages/*"\n');
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/fixture-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'workspace',
        'validate',
        dir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'workspace');
        assert.equal(payload.diagnostic.code, 'workspace.shared_package.missing');
        assert.match(payload.failureReason, /共享包/);
        assert.match(payload.failureReason, /@demo\/shared-utils/);
        assert.match(payload.failureReason, /packages\/shared-utils\/package\.json/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace validate blocks existing workspace shared packages with an explicit unsupported-inlining diagnostic', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-workspace-shared-unsupported-'));
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    const packageJson = JSON.parse(await readFile(path.join(componentDir, 'package.json'), 'utf8'));
    packageJson.dependencies['@demo/shared-utils'] = 'workspace:*';
    await writeFile(path.join(componentDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "components/*"\n  - "packages/*"\n');
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/fixture-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));
    await writeFileTree(path.join(dir, 'packages/shared-utils'), {
      'package.json': JSON.stringify({
        name: '@demo/shared-utils',
        version: '0.1.0',
        type: 'module',
      }, null, 2),
      'src/index.ts': 'export const tone = "warm";',
    });

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'workspace',
        'validate',
        dir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'workspace');
        assert.equal(payload.diagnostic.code, 'workspace.shared_package.inline_unsupported');
        assert.match(payload.failureReason, /暂不支持自动内联/);
        assert.match(payload.failureReason, /@demo\/shared-utils/);
        assert.match(payload.failureReason, /packages\/shared-utils/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('workspace validate rejects manifest id mismatches before upload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-workspace-mismatch-'));
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/wrong-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'workspace',
        'validate',
        dir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'workspace');
        assert.equal(payload.diagnostic.code, 'workspace.component.manifest_id_mismatch');
        assert.match(payload.failureReason, /@demo\/wrong-component/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setup-ci --workspace writes a matrix workflow with explicit component paths', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-setup-ci-workspace-'));
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/fixture-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'setup-ci',
      dir,
      '--provider',
      'github',
      '--workspace',
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'setup-ci');
    assert.equal(payload.provider, 'github');
    assert.equal(payload.workspace, true);
    assert.equal(payload.workflowPath, path.join(dir, '.github/workflows/promptframe-workspace.yml'));
    assert.deepEqual(payload.components, [{
      id: '@demo/fixture-component',
      path: 'components/motion-intro/image-particle-remotion',
    }]);
    assert.deepEqual(payload.optionalVariables, ['RUNNER_LABELS']);

    const workflow = await readFile(payload.workflowPath, 'utf8');
    assert.match(workflow, /# promptframe-workflow-version: 2/);
    assert.match(workflow, /Discover PromptFrame components/);
    assert.match(workflow, /promptframe-workspace\.json/);
    assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.discover\.outputs\.matrix\) \}\}/);
    assert.match(workflow, /COMPONENT_ID: \$\{\{ matrix\.componentId \}\}/);
    assert.match(workflow, /COMPONENT_PATH: \$\{\{ matrix\.componentPath \}\}/);
    assert.match(workflow, /vars\.RUNNER_LABELS/);
    assert.match(workflow, /npm install -g pnpm@10/);
    assert.match(workflow, /pnpm install --no-frozen-lockfile/);
    assert.match(workflow, /promptframe workspace validate \. --json/);
    assert.match(workflow, /promptframe check \. --workspace-component "\$COMPONENT_ID" --json/);
    assert.match(workflow, /PROMPTFRAME_VERSION_NOTES=/);
    assert.match(workflow, /promptframe upload \. --workspace-component "\$COMPONENT_ID" --endpoint "\$PROMPTFRAME_API_BASE" --release-notes "\$PROMPTFRAME_VERSION_NOTES" --json/);
    assert.match(workflow, /promptframe status "\$BUILD_ID" --endpoint "\$PROMPTFRAME_API_BASE" --json --fail-on-build-failed/);
    assert.match(workflow, /promptframe-check-\$\{\{ matrix\.artifactName \}\}/);
    assert.match(workflow, /promptframe-upload-\$\{\{ matrix\.artifactName \}\}/);
    assert.doesNotMatch(workflow, /Link lockfile for workspace components/);
    assert.doesNotMatch(workflow, /pf_(?:ci|human|cli)_[A-Za-z0-9_-]+/);
    assert.doesNotMatch(workflow, /promptframe-beta|tail0fae3a|100\.\d+\.\d+\.\d+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload --workspace-component sends explicit source metadata headers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-workspace-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      assert.equal(req.headers['x-promptframe-source-mode'], 'workspace');
      assert.equal(req.headers['x-promptframe-source-workspace-config'], 'promptframe-workspace.json');
      assert.equal(req.headers['x-promptframe-source-workspace-component-id'], '@demo/fixture-component');
      assert.equal(req.headers['x-promptframe-source-component-path'], 'components/motion-intro/image-particle-remotion');
      assert.equal(req.headers['x-promptframe-source-manifest-id'], '@demo/fixture-component');
      assert.match(body.toString('latin1'), /manifest\.json/);
      writeJson(res, { success: true, buildId: 'build-workspace', status: 'queued' });
      return;
    }
    res.statusCode = 404;
    writeJson(res, { success: false, error: `unexpected ${req.method} ${req.url}` });
  });
  try {
    const componentDir = path.join(dir, 'components/motion-intro/image-particle-remotion');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [{
        id: '@demo/fixture-component',
        path: 'components/motion-intro/image-particle-remotion',
      }],
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      dir,
      '--workspace-component',
      '@demo/fixture-component',
      '--endpoint',
      server.url,
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'upload');
    assert.equal(payload.jobId, 'build-workspace');
    assert.equal(payload.source.mode, 'workspace');
    assert.equal(payload.source.workspaceComponentId, '@demo/fixture-component');
    assert.equal(payload.source.componentPath, 'components/motion-intro/image-particle-remotion');
    assert.deepEqual(calls.map((call) => call.url), [
      '/components/standard',
      '/components/marketplace/upload',
    ]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('check auto-detects a workspace root and checks configured components', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-workspace-root-'));
  try {
    await writeWorkspaceFixtureComponent(path.join(dir, 'components/alpha-motion'), '@demo/alpha-motion');
    await writeWorkspaceFixtureComponent(path.join(dir, 'components/beta-motion'), '@demo/beta-motion');
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [
        { id: '@demo/alpha-motion', path: 'components/alpha-motion' },
        { id: '@demo/beta-motion', path: 'components/beta-motion' },
      ],
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      dir,
      '--json',
    ])).stdout);

    assert.equal(payload.command, 'check');
    assert.equal(payload.workspace, true);
    assert.equal(payload.source.mode, 'workspace');
    assert.equal(payload.diagnostic.code, 'check.workspace.completed');
    assert.deepEqual(payload.components.map((component) => component.id), [
      '@demo/alpha-motion',
      '@demo/beta-motion',
    ]);
    assert.deepEqual(payload.components.map((component) => component.source.componentPath), [
      'components/alpha-motion',
      'components/beta-motion',
    ]);
    assert.ok(payload.components.every((component) => component.diagnostic.code === 'check.completed'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload auto-detects a workspace root and uploads configured components', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-workspace-root-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      const componentId = req.headers['x-promptframe-source-workspace-component-id'];
      writeJson(res, {
        success: true,
        buildId: componentId === '@demo/alpha-motion' ? 'build-alpha' : 'build-beta',
        status: 'queued',
      });
      return;
    }
    res.statusCode = 404;
    writeJson(res, { success: false, error: `unexpected ${req.method} ${req.url}` });
  });
  try {
    await writeWorkspaceFixtureComponent(path.join(dir, 'components/alpha-motion'), '@demo/alpha-motion');
    await writeWorkspaceFixtureComponent(path.join(dir, 'components/beta-motion'), '@demo/beta-motion');
    await writeFile(path.join(dir, 'promptframe-workspace.json'), JSON.stringify({
      schemaVersion: 'promptframe-workspace.v0.1.0',
      components: [
        { id: '@demo/alpha-motion', path: 'components/alpha-motion' },
        { id: '@demo/beta-motion', path: 'components/beta-motion' },
      ],
    }, null, 2));

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      dir,
      '--endpoint',
      server.url,
      '--json',
    ])).stdout);

    const uploadCalls = calls.filter((call) => call.url === '/components/marketplace/upload');
    assert.equal(payload.command, 'upload');
    assert.equal(payload.workspace, true);
    assert.equal(payload.diagnostic.code, 'upload.workspace.completed');
    assert.deepEqual(payload.uploads.map((upload) => upload.jobId), ['build-alpha', 'build-beta']);
    assert.deepEqual(uploadCalls.map((call) => call.headers['x-promptframe-source-workspace-component-id']), [
      '@demo/alpha-motion',
      '@demo/beta-motion',
    ]);
    assert.deepEqual(uploadCalls.map((call) => call.headers['x-promptframe-source-component-path']), [
      'components/alpha-motion',
      'components/beta-motion',
    ]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects unknown public authoring targets before network transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-target-'));
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'upload',
        zipPath,
        '--endpoint',
        'https://promptframe.invalid/api-proxy',
        '--target',
        'raw_esm_direct',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'upload');
        assert.equal(payload.diagnostic.code, 'upload.target.invalid');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload blocks stale marketplace authoring packages before network transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-freshness-'));
  let calls = 0;
  const server = await createServer(async (_req, res) => {
    calls += 1;
    writeJson(res, { success: false, error: 'upload should not reach network' });
  });
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.4',
        '@promptframe/component-kit': '^0.1.5',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.5',
      },
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'upload',
        componentDir,
        '--endpoint',
        server.url,
        '--target',
        'marketplace_authoring',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'upload');
        assert.equal(payload.diagnostic.code, 'component_standard.authoring_package.contracts.min_version');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
    assert.equal(calls, 0);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload blocks stale marketplace authoring packages inside zip before network transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-zip-freshness-'));
  let calls = 0;
  const server = await createServer(async (_req, res) => {
    calls += 1;
    writeJson(res, { success: true, buildId: 'should-not-upload', status: 'queued' });
  });
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.4',
        '@promptframe/component-kit': '^0.1.5',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.5',
      },
    }, null, 2));
    const zipPath = path.join(dir, 'component.zip');
    await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      zipPath,
    ]);

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'upload',
        zipPath,
        '--endpoint',
        server.url,
        '--target',
        'marketplace_authoring',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'upload');
        assert.equal(payload.diagnostic.code, 'component_standard.authoring_package.contracts.min_version');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
    assert.equal(calls, 0);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload blocks stale remote standard source hash before package upload transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-sourcehash-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push(req.url);
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: `sha256:${'9'.repeat(64)}`,
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      writeJson(res, { success: true, buildId: 'should-not-upload', status: 'queued' });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'upload',
        componentDir,
        '--endpoint',
        server.url,
        '--target',
        'marketplace_authoring',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'upload');
        assert.equal(payload.diagnostic.code, 'standard.freshness.upload_blocking');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
    assert.deepEqual(calls, ['/components/standard']);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('check reports offline degraded freshness when no platform endpoint is configured', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-offline-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const check = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'project_private_generation',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
        PROMPTFRAME_CONFIG: path.join(dir, 'missing-config.json'),
      },
    })).stdout);
    assert.equal(check.command, 'check');
    assert.equal(check.freshness.status, 'warning');
    assert.equal(check.freshness.diagnostic.code, 'standard.freshness.offline_degraded');
    assert.equal(check.freshness.retryable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check reports local reusability diagnostics for low-reuse marketplace authoring components', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-reuse-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const check = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'marketplace_authoring',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
        PROMPTFRAME_CONFIG: path.join(dir, 'missing-config.json'),
      },
    })).stdout);

    assert.equal(check.localReusability.contractVersion, 'component-reusability.v0.1.0');
    assert.equal(check.localReusability.uploadTarget, 'marketplace_authoring');
    assert.equal(check.localReusability.recommendation, 'manual_review');
    assert.ok(check.localReusability.score < 0.55);
    assert.ok(check.localReusability.signals.some((signal) => signal.id === 'propsRichness'));
    assert.equal(check.diagnostics[0].code, 'component_market.reusability.marketplace_manual_review');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate and check report unknown private style props as authoring diagnostics', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-style-props-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/schema.ts'), [
      "import { z } from 'zod';",
      'export const propsSchema = z.object({',
      "  title: z.string().describe('Primary title text shown in the scene.'),",
      "  theme: z.string().describe('Custom visual theme name for the component.').optional(),",
      "  foregroundColor: z.string().describe('Custom foreground color override.').optional(),",
      '  styleIntent: z.object({',
      '    accentColor: z.string().optional(),',
      "  }).describe('Nested style intent object used by the component.').optional(),",
      '});',
      'export type ComponentProps = z.infer<typeof propsSchema>;',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.ok(validate.checkedRuleIds.includes('component.style.unknown_custom_style_prop'));
    assert.deepEqual(
      validate.diagnostics
        .filter((item) => item.code === 'component.style.unknown_custom_style_prop')
        .map((item) => item.propName)
        .sort(),
      ['foregroundColor', 'theme'],
    );

    const check = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'project_private_generation',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
        PROMPTFRAME_CONFIG: path.join(dir, 'missing-config.json'),
      },
    })).stdout);
    assert.ok(check.diagnostics.some((item) => (
      item.code === 'component.style.unknown_custom_style_prop'
      && item.severity === 'warning'
      && item.message.includes('theme')
    )));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate and check hard-fail missing layout manifest and fixed root dimensions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-layout-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const manifestPath = path.join(componentDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.layout;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component.layout.manifest_required');
        assert.match(payload.failureReason, /layout capability/i);
        return true;
      },
    );

    manifest.layout = fixtureLayoutCapability();
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  return <AbsoluteFill style={{ width: 440, height: 290 }} />;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'check',
        componentDir,
        '--target',
        'project_private_generation',
        '--json',
      ], {
        env: {
          ...process.env,
          PROMPTFRAME_API_BASE: '',
          REMOTION_MEDIA_API_BASE: '',
          PROMPTFRAME_CONFIG: path.join(dir, 'missing-config.json'),
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'check');
        assert.equal(payload.diagnostic.code, 'component.layout.root_fixed_size');
        assert.match(payload.failureReason, /fixed final width\/height/i);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check blocks stale remote standard source hash when endpoint is configured', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-sourcehash-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    calls.push(req.url);
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: `sha256:${'8'.repeat(64)}`,
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'check',
        componentDir,
        '--endpoint',
        server.url,
        '--target',
        'marketplace_authoring',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'check');
        assert.equal(payload.diagnostic.code, 'standard.freshness.upload_blocking');
        return true;
      },
    );
    assert.deepEqual(calls, ['/components/standard']);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload accepts marketplace strict target alias before platform transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-strict-alias-'));
  const calls = [];
  const server = await createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({ method: req.method, url: req.url, target: req.headers['x-promptframe-upload-target'], body });
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      writeJson(res, { success: true, jobId: 'build-strict', status: 'queued' });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    const upload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      componentDir,
      '--endpoint',
      server.url,
      '--target',
      'marketplace',
      '--strict',
      '--json',
    ])).stdout);
    assert.equal(upload.command, 'upload');
    assert.equal(upload.uploadTarget, 'marketplace_authoring');
    assert.equal(upload.jobId, 'build-strict');
    assert.deepEqual(calls.map((call) => call.url), ['/components/standard', '/components/marketplace/upload']);
    assert.equal(calls[1].target, 'marketplace_authoring');
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('directory upload returns local reusability diagnostics with the accepted platform response', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-reuse-'));
  const server = await createServer(async (req, res) => {
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      writeJson(res, { success: true, jobId: 'build-reuse', status: 'queued' });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    const upload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upload',
      componentDir,
      '--endpoint',
      server.url,
      '--target',
      'marketplace_authoring',
      '--json',
    ])).stdout);

    assert.equal(upload.command, 'upload');
    assert.equal(upload.jobId, 'build-reuse');
    assert.equal(upload.localReusability.recommendation, 'manual_review');
    assert.equal(upload.diagnostics[0].code, 'component_market.reusability.marketplace_manual_review');
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload --json redacts public-unsafe platform response fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-json-safe-'));
  const server = await createServer(async (req, res) => {
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      writeJson(res, {
        success: true,
        buildId: 'build-safe-json',
        status: 'succeeded',
        statusUrl: '/admin/components/builds/build-safe-json',
        providerUsageReceipt: { provider: 'internal' },
        vectorRef: 'minio://private/vector',
        retryKey: 'retry-secret',
        sourceHash: 'sha256:source-secret',
        build: {
          buildId: 'build-safe-json',
          status: 'succeeded',
          statusUrl: '/admin/components/builds/build-safe-json',
          sourceHash: 'sha256:nested-source-secret',
          diagnostics: [{ code: 'component.internal', severity: 'info', message: 'Internal REQ-150 note' }],
        },
        evidence: [{
          evidenceId: 'evidence-secret',
          vectorRef: 'minio://private/evidence-vector',
          providerUsageReceipt: { provider: 'internal' },
        }],
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'upload',
      zipPath,
      '--endpoint',
      server.url,
      '--target',
      'project_private_generation',
      '--json',
    ]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.command, 'upload');
    assert.equal(payload.jobId, 'build-safe-json');
    assert.equal(payload.build.status, 'succeeded');
    assert.equal(payload.evidence, undefined);
    assert.equal(payload.providerUsageReceipt, undefined);
    assert.equal(payload.build.sourceHash, undefined);
    assert.equal(stdout.includes('providerUsageReceipt'), false);
    assert.equal(stdout.includes('vectorRef'), false);
    assert.equal(stdout.includes('retry-secret'), false);
    assert.equal(stdout.includes('REQ-150'), false);
    assert.equal(stdout.includes('sha256:source-secret'), false);
    assert.equal(stdout.includes('evidence-secret'), false);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload default output prints status link and next status command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-upload-human-output-'));
  const server = await createServer(async (req, res) => {
    if (req.url === '/components/standard') {
      writeJson(res, {
        success: true,
        sourceVersion: 'component-standard.v0.1.0',
        sourceHash: 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52',
      });
      return;
    }
    if (req.url === '/components/marketplace/upload') {
      writeJson(res, {
        success: true,
        buildId: 'build-human',
        status: 'succeeded',
        statusUrl: '/admin/components/builds/build-human',
      });
      return;
    }
    writeJson(res, { success: false, error: `unexpected path: ${req.url}` }, 404);
  });
  try {
    const zipPath = path.join(dir, 'component.zip');
    await writeFile(zipPath, 'fake component zip');
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'upload',
      zipPath,
      '--endpoint',
      server.url,
      '--target',
      'project_private_generation',
    ]);

    assert.match(stdout, /Upload accepted/);
    assert.match(stdout, /Build: build-human/);
    assert.match(stdout, /Status: succeeded/);
    assert.match(stdout, new RegExp(`Status URL: ${server.url}/admin/components/builds/build-human`));
    assert.match(stdout, new RegExp(`Next: promptframe status build-human --endpoint ${server.url}`));
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('package validates a component folder and writes a platform zip artifact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-package-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    const out = path.join(dir, 'component.zip');
    const { stdout } = await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      out,
    ]);
    const payload = JSON.parse(stdout);
    assert.equal(payload.command, 'package');
    assert.equal(payload.diagnostic.code, 'package.completed');
    assert.equal(payload.out, out);
    assert.match(payload.sha256, /^sha256:[a-f0-9]{64}$/);
    const zip = await readFile(out);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.match(zip.toString('latin1'), /manifest\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate check and package report accepted public resources deterministically', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-public-resources-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await mkdir(path.join(componentDir, 'public/assets'), { recursive: true });
    await writeFile(path.join(componentDir, 'public/data.json'), JSON.stringify({ label: 'Demo' }));
    await writeFile(path.join(componentDir, 'public/assets/logo.png'), 'fake png bytes');

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.publicResources.status, 'accepted');
    assert.equal(validate.publicResources.total, 2);
    assert.deepEqual(validate.publicResources.entries.map((entry) => entry.publicPath), [
      '/assets/logo.png',
      '/data.json',
    ]);
    assert.ok(validate.diagnostics.some((item) => item.code === 'component_resources.public.accepted'));

    const check = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'project_private_generation',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
        PROMPTFRAME_CONFIG: path.join(dir, 'missing-config.json'),
      },
    })).stdout);
    assert.equal(check.publicResources.contractVersion, 'component-public-resources.v0.1.0');
    assert.equal(check.publicResources.total, 2);

    const out = path.join(dir, 'component.zip');
    const packaged = JSON.parse((await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      out,
    ])).stdout);
    assert.equal(packaged.publicResources.status, 'accepted');
    assert.equal(packaged.publicResources.entries[0].sourcePath, 'public/assets/logo.png');
    const names = zipEntryNames(await readFile(out));
    assert.equal(names.includes('public/assets/logo.png'), true);
    assert.equal(names.includes('public/data.json'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects unsafe SVG public resources before upload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-public-resource-svg-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await mkdir(path.join(componentDir, 'public'), { recursive: true });
    await writeFile(path.join(componentDir, 'public/unsafe.svg'), '<svg><script>alert(1)</script></svg>');

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /component_resources\.public\.svg_rejected/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('package excludes local preview cases from .promptframe while keeping canonical preview props', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-package-local-previews-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await mkdir(path.join(componentDir, '.promptframe/local-previews'), { recursive: true });
    await writeFile(
      path.join(componentDir, '.promptframe/local-previews/wide.json'),
      JSON.stringify({ marker: 'LOCAL_PREVIEW_SHOULD_NOT_SHIP' }),
    );
    const out = path.join(dir, 'component.zip');
    await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      out,
    ]);
    const zipText = (await readFile(out)).toString('latin1');
    assert.match(zipText, /src\/preview-props\.json/);
    assert.doesNotMatch(zipText, /\.promptframe\/local-previews/);
    assert.doesNotMatch(zipText, /LOCAL_PREVIEW_SHOULD_NOT_SHIP/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('package excludes raw package manager lockfiles but includes sanitized lockfile evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-package-lockfiles-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'fixture-component',
          dependencies: {
            '@promptframe/contracts': '^0.1.5',
          },
        },
        'node_modules/@promptframe/contracts': {
          resolved: 'https://registry.npmjs.org/@promptframe/contracts/-/contracts-0.1.6.tgz',
        },
      },
    }, null, 2));
    await writeFile(path.join(componentDir, 'pnpm-lock.yaml'), [
      'lockfileVersion: "9.0"',
      'packages:',
      '  remotion@4.0.0:',
      '    resolution: {integrity: sha512-demo}',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');

    const out = path.join(dir, 'component.zip');
    await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      out,
    ]);
    const zip = await readFile(out);
    const zipText = zip.toString('latin1');
    const names = zipEntryNames(zip);
    assert.equal(names.includes('package-lock.json'), false);
    assert.equal(names.includes('pnpm-lock.yaml'), false);
    assert.equal(names.includes('promptframe-lockfile-evidence.json'), true);
    assert.match(zipText, /"schemaVersion":"promptframe\.lockfile-evidence\.v0\.1\.0"/);
    assert.match(zipText, /"fileName":"package-lock\.json"/);
    assert.match(zipText, /"fileName":"pnpm-lock\.yaml"/);
    assert.match(zipText, /"sha256":"sha256:[a-f0-9]{64}"/);
    assert.doesNotMatch(zipText, /registry\.npmjs\.org/);
    assert.doesNotMatch(zipText, /resolution: \{integrity:/);
    assert.doesNotMatch(zipText, /lockfileVersion: "9\.0"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('package accepts pnpm workspace root lockfile evidence without component symlink', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-package-workspace-lockfile-'));
  try {
    const componentDir = path.join(dir, 'components/fixture-component');
    await writeFixtureComponent(componentDir);
    await rm(path.join(componentDir, 'pnpm-lock.yaml'), { force: true });
    await writeFile(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "components/*"\n');
    await writeFile(path.join(dir, 'pnpm-lock.yaml'), [
      'lockfileVersion: "9.0"',
      'packages:',
      '  remotion@4.0.0:',
      '    resolution: {integrity: sha512-workspace-demo}',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');

    const out = path.join(dir, 'component.zip');
    await execFileAsync('node', [
      cliPath,
      'package',
      componentDir,
      '--out',
      out,
    ]);
    const zip = await readFile(out);
    const zipText = zip.toString('latin1');
    const names = zipEntryNames(zip);
    assert.equal(names.includes('pnpm-lock.yaml'), false);
    assert.equal(names.includes('promptframe-lockfile-evidence.json'), true);
    assert.match(zipText, /"fileName":"pnpm-lock\.yaml"/);
    assert.match(zipText, /"source":"workspace_root"/);
    assert.match(zipText, /"relativePath":"\.\.\/\.\.\/pnpm-lock\.yaml"/);
    assert.doesNotMatch(zipText, /workspace-demo/);
    assert.doesNotMatch(zipText, /lockfileVersion: "9\.0"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate blocks install scripts before package or upload transport', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-dependency-install-script-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      scripts: {
        postinstall: 'node scripts/install.js',
      },
      dependencies: {
        react: '^19.1.0',
        '@promptframe/contracts': '^0.1.8',
        '@promptframe/component-kit': '^0.1.7',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.21',
      },
    }, null, 2));
    await writeFile(path.join(componentDir, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'dependency.install.script_forbidden');
        assert.equal(payload.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check reports dependency quarantine without marking it public searchable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-dependency-quarantine-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        react: '^19.1.0',
        '@unknown/visual-engine': '1.2.3',
        '@promptframe/contracts': '^0.1.8',
        '@promptframe/component-kit': '^0.1.7',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.21',
      },
    }, null, 2));
    await writeFile(path.join(componentDir, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');

    const payload = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    })).stdout);

    assert.equal(payload.command, 'check');
    assert.equal(payload.dependencyPolicy.status, 'manual_review');
    assert.equal(payload.dependencyPolicy.quarantine, true);
    assert.equal(payload.dependencyPolicy.publicSearchableAllowed, false);
    assert.ok(payload.diagnostics.some((item) => item.code === 'dependency.catalog.unknown_dependency'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preview exposes a local Remotion preview envelope without a platform endpoint', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const { stdout } = await execFileAsync('node', [
      cliPath,
      'preview',
      componentDir,
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    });
    const payload = JSON.parse(stdout);

    assert.equal(payload.command, 'preview');
    assert.equal(payload.dir, componentDir);
    assert.equal(payload.diagnostic.code, 'preview.ready');
    assert.equal(payload.renderingSystem, 'remotion');
    assert.equal(payload.preview.durationFrames, 60);
    assert.equal(payload.preview.fps, 30);
    assert.equal(payload.preview.width, 1280);
    assert.equal(payload.preview.height, 720);
    assert.deepEqual(payload.preview.props, {});
    assert.deepEqual(payload.localDevCommand, ['npm', 'run', 'dev']);
    assert.equal(payload.previewSource, 'src/preview-props.json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preview writes a local preview report for canonical and saved cases', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-report-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await mkdir(path.join(componentDir, '.promptframe/local-previews'), { recursive: true });
    await writeFile(path.join(componentDir, '.promptframe/local-previews/square.json'), JSON.stringify({
      name: 'Square stress',
      durationFrames: 60,
      fps: 30,
      width: 720,
      height: 720,
      props: { title: 'Saved local case' },
    }, null, 2));

    const { stdout } = await execFileAsync('node', [
      cliPath,
      'preview',
      componentDir,
      '--write-local-report',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    });
    const payload = JSON.parse(stdout);
    const reportPath = path.join(componentDir, '.promptframe/local-previews/preview-report.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));

    assert.equal(payload.command, 'preview');
    assert.equal(payload.localPreviewReport.path, reportPath);
    assert.equal(payload.localPreviewReport.caseCount, 2);
    assert.equal(payload.localPreviewReport.diagnostic.code, 'preview.local_report.written');
    assert.equal(report.reportVersion, 'promptframe-local-preview-report.v1');
    assert.equal(report.component.id, '@demo/fixture-component');
    assert.deepEqual(report.cases.map((previewCase) => previewCase.source), [
      'src/preview-props.json',
      '.promptframe/local-previews/square.json',
    ]);
    assert.ok(report.cases.every((previewCase) => previewCase.envelopeHash.startsWith('sha256:')));
    assert.ok(report.cases.every((previewCase) => previewCase.propsHash.startsWith('sha256:')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dev prepares a real Remotion Player local preview command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-dev-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const { stdout } = await execFileAsync('node', [
      cliPath,
      'dev',
      componentDir,
      '--host',
      '127.0.0.1',
      '--port',
      '5321',
      '--dry-run',
      '--json',
    ], {
      env: {
        ...process.env,
        PROMPTFRAME_API_BASE: '',
        REMOTION_MEDIA_API_BASE: '',
      },
    });
    const payload = JSON.parse(stdout);

    assert.equal(payload.command, 'dev');
    assert.equal(payload.renderingSystem, 'remotion-player');
    assert.equal(payload.previewSource, 'src/preview-props.json');
    assert.equal(payload.devServer.url, 'http://127.0.0.1:5321');
    assert.deepEqual(payload.devServer.command, [
      'npm',
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '5321',
    ]);
    assert.equal(payload.diagnostic.code, 'dev.ready');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dev and check block missing marketplace authoring package floors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-freshness-check-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'dev',
        componentDir,
        '--dry-run',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'dev');
        assert.equal(payload.diagnostic.code, 'component_standard.authoring_package.contracts.missing');
        return true;
      },
    );

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'check',
        componentDir,
        '--target',
        'marketplace_authoring',
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.command, 'check');
        assert.equal(payload.diagnostic.code, 'component_standard.authoring_package.contracts.missing');
        return true;
      },
    );

    const projectPrivateCheck = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'project_private_generation',
      '--json',
    ])).stdout);
    assert.equal(projectPrivateCheck.command, 'check');
    assert.equal(projectPrivateCheck.freshness.target, 'project_private_generation');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local standard, doctor, and validate expose stable JSON diagnostics', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-local-json-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const standard = JSON.parse((await execFileAsync('node', [
      cliPath,
      'standard',
      '--json',
    ])).stdout);
    assert.equal(standard.command, 'standard');
    assert.equal(standard.diagnostic.code, 'standard.completed');
    assert.deepEqual(standard.supportedComponentTypes, [
      'scene_template',
      'contained_widget',
      'overlay',
      'transition_effect',
    ]);
    assert.equal(standard.authoringStandardRelease.releaseVersion, 'authoring-standard-release.v0.1.0');
    assert.equal(standard.authoringStandardRelease.standardVersion, 'component-standard.v0.1.0');
    assert.match(standard.authoringStandardRelease.standardSourceHash, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(standard.authoringStandardRelease.uploadTargets.map((target) => target.target), [
      'marketplace_authoring',
      'project_private_generation',
    ]);
    assert.equal(standard.freshness.status, 'current');
    assert.equal(standard.freshness.target, 'marketplace_authoring');
    assert.equal(standard.freshness.currentStandardSourceHash, standard.authoringStandardRelease.standardSourceHash);
    assert.equal(standard.securityEvaluatorMode, 'ast');
    assert.match(standard.securityPolicyDigest, /^component-security-policy-digest\.v0\.1:/);

    const doctor = JSON.parse((await execFileAsync('node', [
      cliPath,
      'doctor',
      '--json',
    ], { cwd: componentDir })).stdout);
    assert.equal(doctor.command, 'doctor');
    assert.equal(doctor.dir, componentDir);
    assert.equal(doctor.diagnostic.code, 'doctor.completed');
    assert.deepEqual(doctor.requiredFiles, [
      'manifest.json',
      'package.json',
      'src/Component.tsx',
      'src/schema.ts',
      'src/index.ts',
      'src/preview-props.json',
    ]);

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.dir, componentDir);
    assert.equal(validate.diagnostic.code, 'validate.completed');
    assert.equal(validate.manifest.id, '@demo/fixture-component');
    assert.equal(validate.manifest.componentType, 'scene_template');
    assert.equal(validate.securityEvaluatorMode, 'ast');
    assert.equal(validate.securityPolicyDigest, standard.securityPolicyDigest);
    assert.deepEqual(validate.checkedRuleIds, [
      'manifest.identity.version',
      'manifest.component_type.supported',
      'component.layout.manifest_required',
      'component.layout.manifest_invalid',
      'component.layout.root_fixed_size',
      'component.layout.root_viewport_unit',
      'component.layout.naked_px_high_risk',
      'component.layout.naked_px_medium_risk',
      'component.style.global_css_forbidden',
      'component.animation.css_timeline_forbidden',
      'evidence.schema_source_hash_present',
      'runtime.deterministic.remotion',
      'runtime.deterministic.fps_hardcoded_timing',
      'security.forbidden.browser_apis',
      'security.no_raw_remote_url_import',
      'package.no_parent_imports',
      'component.style.unknown_custom_style_prop',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check and upgrade expose freshness and package floor diagnostics', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-check-upgrade-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);

    const check = JSON.parse((await execFileAsync('node', [
      cliPath,
      'check',
      componentDir,
      '--target',
      'project_private_generation',
      '--json',
    ])).stdout);
    assert.equal(check.command, 'check');
    assert.equal(check.diagnostic.code, 'check.completed');
    assert.equal(check.freshness.target, 'project_private_generation');
    assert.equal(check.freshness.status, 'warning');
    assert.equal(check.freshness.diagnostic.code, 'standard.freshness.offline_degraded');
    assert.equal(check.securityEvaluatorMode, 'ast');
    assert.match(check.securityPolicyDigest, /^component-security-policy-digest\.v0\.1:/);
    assert.deepEqual(check.checkedRuleIds, [
      'manifest.identity.version',
      'manifest.component_type.supported',
      'component.layout.manifest_required',
      'component.layout.manifest_invalid',
      'component.layout.root_fixed_size',
      'component.layout.root_viewport_unit',
      'component.layout.naked_px_high_risk',
      'component.layout.naked_px_medium_risk',
      'component.style.global_css_forbidden',
      'component.animation.css_timeline_forbidden',
      'evidence.schema_source_hash_present',
      'runtime.deterministic.remotion',
      'runtime.deterministic.fps_hardcoded_timing',
      'security.forbidden.browser_apis',
      'security.no_raw_remote_url_import',
      'package.no_parent_imports',
      'component.style.unknown_custom_style_prop',
    ]);

    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.4',
        '@promptframe/component-kit': '^0.1.5',
      },
      devDependencies: {
        '@promptframe/cli': '0.1.5',
      },
    }, null, 2));
    const upgrade = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upgrade',
      componentDir,
      '--dry-run',
      '--json',
    ])).stdout);
    assert.equal(upgrade.command, 'upgrade');
    assert.equal(upgrade.diagnostic.code, 'upgrade.dry_run');
    assert.equal(upgrade.apply, false);
    assert.ok(upgrade.packageChanges.some((change) => (
      change.name === '@promptframe/contracts'
      && change.current === '^0.1.4'
      && change.next === '^0.1.5'
    )));
    assert.ok(upgrade.packageChanges.some((change) => (
      change.name === '@promptframe/component-kit'
      && change.next === '^0.1.6'
    )));
    assert.ok(upgrade.packageChanges.some((change) => (
      change.name === '@promptframe/cli'
      && change.next === '^0.1.6'
    )));

    const applied = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upgrade',
      componentDir,
      '--apply',
      '--json',
    ])).stdout);
    assert.equal(applied.command, 'upgrade');
    assert.equal(applied.diagnostic.code, 'upgrade.applied');
    assert.equal(applied.apply, true);
    assert.ok(applied.packageChanges.some((change) => change.name === '@promptframe/contracts'));
    const appliedPackageJson = JSON.parse(await readFile(path.join(componentDir, 'package.json'), 'utf8'));
    assert.equal(appliedPackageJson.dependencies['@promptframe/contracts'], '^0.1.5');
    assert.equal(appliedPackageJson.dependencies['@promptframe/component-kit'], '^0.1.6');
    assert.equal(appliedPackageJson.devDependencies['@promptframe/cli'], '^0.1.6');

    await writeFile(path.join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.5',
        '@promptframe/component-kit': '^0.1.6',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.10',
      },
    }, null, 2));
    const current = JSON.parse((await execFileAsync('node', [
      cliPath,
      'upgrade',
      componentDir,
      '--dry-run',
      '--json',
    ])).stdout);
    assert.deepEqual(current.packageChanges, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local JSON failures expose diagnostic failure reasons', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-local-json-failure-'));
  try {
    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'doctor',
        '--json',
      ], { cwd: dir }),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'doctor');
        assert.equal(payload.diagnostic.code, 'doctor.required_files.missing');
        assert.match(payload.failureReason, /Missing required files/);
        assert.equal(payload.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor requires the public standard component entrypoint file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-required-files-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await rm(path.join(componentDir, 'src/index.ts'), { force: true });

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'doctor',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'doctor');
        assert.equal(payload.diagnostic.code, 'doctor.required_files.missing');
        assert.match(payload.failureReason, /src\/index\.ts/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects preview props that exceed the public standard limits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/preview-props.json'), JSON.stringify({
      durationFrames: 181,
      fps: 30,
      width: 1280,
      height: 720,
      props: {},
    }));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.preview.duration_frames.max');
        assert.match(payload.failureReason, /durationFrames/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects preview props fields that are not declared in schema.ts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-schema-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/schema.ts'), [
      "import { z } from 'zod';",
      'export const propsSchema = z.object({',
      "  title: z.string().describe('Primary title text shown in the scene.'),",
      "  background: z.string().describe('Background color for the scene.').optional(),",
      '});',
      'export type ComponentProps = z.infer<typeof propsSchema>;',
    ].join('\n'));
    await writeFile(path.join(componentDir, 'src/preview-props.json'), JSON.stringify({
      durationFrames: 60,
      fps: 30,
      width: 1280,
      height: 720,
      props: {
        title: 'Known title',
        unexpectedMediaUrl: 'https://example.invalid/video.mp4',
      },
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.preview_props.unknown_prop');
        assert.match(payload.failureReason, /unexpectedMediaUrl/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects public props without schema descriptions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-prop-description-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/schema.ts'), [
      "import { z } from 'zod';",
      'export const propsSchema = z.object({',
      "  title: z.string().default('Hero'),",
      "  foreground: z.string().default('#ffffff'),",
      '});',
      'export type ComponentProps = z.infer<typeof propsSchema>;',
    ].join('\n'));
    await writeFile(path.join(componentDir, 'src/preview-props.json'), JSON.stringify({
      durationFrames: 60,
      fps: 30,
      width: 1280,
      height: 720,
      props: {
        title: 'Hero',
        foreground: '#ffffff',
      },
    }, null, 2));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.props.description_missing');
        assert.match(payload.failureReason, /title, foreground/);
        assert.match(payload.diagnostic.repairHint ?? '', /describe|parameterDescriptions/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate compares preview props against propsSchema when helper z.object definitions appear first', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-preview-schema-root-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/schema.ts'), [
      "import { z } from 'zod';",
      'const dataPoint = z.object({',
      '  label: z.string(),',
      '  value: z.number(),',
      '});',
      'export const propsSchema = z.object({',
      "  title: z.string().describe('Primary title text shown above the chart.'),",
      "  dataPoints: z.array(dataPoint).describe('Data points rendered by the chart component.'),",
      '});',
      'export type ComponentProps = z.infer<typeof propsSchema>;',
    ].join('\n'));
    await writeFile(path.join(componentDir, 'src/preview-props.json'), JSON.stringify({
      durationFrames: 60,
      fps: 30,
      width: 1280,
      height: 720,
      props: {
        title: 'Known title',
        dataPoints: [
          { label: 'A', value: 1 },
        ],
      },
    }, null, 2));

    const result = await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, 'validate');
    assert.equal(payload.diagnostic.code, 'validate.completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects deterministic source and security policy violations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-source-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  const value = Math.random();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }}>{value}</AbsoluteFill>;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.source.no_math_random');
        assert.match(payload.failureReason, /Math\.random/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate accepts Remotion Img while still rejecting native img tags', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-img-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }}><Img src="/demo.png" /></AbsoluteFill>;',
      '}',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');

    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }}><img src="/demo.png" alt="" /></AbsoluteFill>;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'component_standard.source.no_native_img');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate ignores tool config text when checking deterministic component source', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-source-config-text-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'eslint.config.js'), [
      'export default [{',
      '  rules: {',
      '    "no-restricted-syntax": ["error", { message: "Use remotion random(seed) instead of Math.random()." }],',
      '  },',
      '}];',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects deterministic security gate violations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-security-policy-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      "  eval('console.log(1)');",
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }} />;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'code.eval');
        assert.match(payload.failureReason, /eval/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects high-risk browser capability policy violations with stable rule IDs', async () => {
  const cases = [
    {
      code: 'browser.broadcast_channel',
      keyword: /BroadcastChannel/i,
      source: "const channel = new BroadcastChannel('promptframe'); channel.close();",
    },
    {
      code: 'browser.webrtc',
      keyword: /WebRTC|RTCPeerConnection/i,
      source: 'const peer = new RTCPeerConnection(); peer.close();',
    },
    {
      code: 'browser.notification',
      keyword: /Notification/i,
      source: 'void Notification.requestPermission();',
    },
    {
      code: 'browser.service_worker',
      keyword: /Service Worker|serviceWorker/i,
      source: "void navigator.serviceWorker.register('/sw.js');",
    },
    {
      code: 'browser.clipboard',
      keyword: /clipboard/i,
      source: "void navigator.clipboard.writeText('secret');",
    },
    {
      code: 'browser.navigator_locks',
      keyword: /locks/i,
      source: "void navigator.locks.request('promptframe', async () => undefined);",
    },
    {
      code: 'browser.audio_context',
      keyword: /AudioContext|AudioWorklet/i,
      source: 'const ctx = new AudioContext(); void ctx;',
    },
    {
      code: 'browser.css_register_property',
      keyword: /CSS\.registerProperty|CSS Houdini/i,
      source: "CSS.registerProperty({ name: '--x', syntax: '<number>', inherits: false, initialValue: '0' });",
    },
    {
      code: 'browser.observer_abuse',
      keyword: /Observer/i,
      source: 'new MutationObserver(() => undefined).observe(document.body, { childList: true });',
    },
    {
      code: 'browser.image_beacon',
      keyword: /Image|beacon/i,
      source: "const img = new Image(); img.src = 'https://exfil.example/pixel';",
    },
    {
      code: 'browser.audio_beacon',
      keyword: /Audio|beacon/i,
      source: "const audio = new Audio('https://exfil.example/audio.mp3'); void audio;",
    },
    {
      code: 'browser.worker_context',
      keyword: /Worker/i,
      source: "const worker = new Worker('/worker.js'); worker.terminate();",
    },
    {
      code: 'browser.window_open',
      keyword: /window\.open|new browsing context/i,
      source: "window.open('https://evil.example', '_blank');",
    },
    {
      code: 'browser.cross_context_message',
      keyword: /postMessage|cross-context/i,
      source: "parent.postMessage({ ok: true }, '*');",
    },
    {
      code: 'browser.dynamic_script',
      keyword: /script/i,
      source: "document.createElement('script');",
    },
    {
      code: 'browser.iframe_escape',
      keyword: /iframe/i,
      source: "document.createElement('iframe');",
    },
    {
      code: 'browser.fingerprint',
      keyword: /fingerprint|navigator|viewport/i,
      source: 'const fp = navigator.userAgent + window.innerWidth; void fp;',
    },
    {
      code: 'storage.browser_storage',
      keyword: /storage|cookie/i,
      source: 'void document.cookie;',
    },
    {
      code: 'dom.dangerous_html',
      keyword: /HTML|innerHTML/i,
      source: "document.body.innerHTML = '<strong>unsafe</strong>';",
    },
    {
      code: 'remotion.delay_render',
      keyword: /delayRender/i,
      source: 'const handle = delayRender(); void handle;',
    },
    {
      code: 'code.dynamic_import',
      keyword: /dynamic import/i,
      source: "void import('./remote-module.js');",
    },
  ];

  for (const item of cases) {
    const dir = await mkdtemp(path.join(os.tmpdir(), `promptframe-cli-${item.code.replace(/\W+/g, '-')}-`));
    try {
      const componentDir = path.join(dir, 'component');
      await writeFixtureComponent(componentDir);
      await writeFile(path.join(componentDir, 'src/Component.tsx'), [
        "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
        'export default function Component() {',
        '  useCurrentFrame();',
        '  useVideoConfig();',
        `  ${item.source}`,
        '  return <AbsoluteFill style={{ width: "100%", height: "100%" }} />;',
        '}',
      ].join('\n'));

      await assert.rejects(
        execFileAsync('node', [
          cliPath,
          'validate',
          componentDir,
          '--json',
        ]),
        (error) => {
          assert.equal(error.code, 1);
          const payload = JSON.parse(error.stderr);
          assert.equal(payload.success, false);
          assert.equal(payload.command, 'validate');
          assert.equal(payload.diagnostic.code, item.code);
          assert.match(payload.failureReason, item.keyword);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('validate uses AST-aware security policy for alias browser capability violations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-security-policy-ast-alias-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'const BC = BroadcastChannel;',
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      "  const channel = new BC('promptframe');",
      '  channel.close();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }} />;',
      '}',
    ].join('\n'));

    await assert.rejects(
      execFileAsync('node', [
        cliPath,
        'validate',
        componentDir,
        '--json',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.success, false);
        assert.equal(payload.command, 'validate');
        assert.equal(payload.diagnostic.code, 'browser.broadcast_channel');
        assert.match(payload.failureReason, /BroadcastChannel/i);
        assert.match(payload.failureReason, /ast/i);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate reports fps hardcoded timing as warning diagnostics without blocking', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-fps-hardcoded-timing-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  const frame = useCurrentFrame();',
      '  useVideoConfig();',
      '  const opacity = interpolate(frame, [0, 15, 30], [0, 1, 0]);',
      '  const progress = spring({ frame, fps: 30 });',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%", opacity }}>{progress}</AbsoluteFill>;',
      '}',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);

    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');
    assert.ok(validate.checkedRuleIds.includes('runtime.deterministic.fps_hardcoded_timing'));
    const diagnostics = validate.diagnostics.filter((item) => item.code === 'runtime.deterministic.fps_hardcoded_timing');
    assert.ok(diagnostics.length >= 2, `expected fps diagnostics, got ${diagnostics.length}`);
    assert.ok(diagnostics.every((item) => item.severity === 'warning'));
    assert.ok(diagnostics.every((item) => item.stage === 'validate'));
    assert.ok(diagnostics.every((item) => /secondsToFrames|createDurationTimeline/.test(item.repairHint ?? '')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate does not reject browser capability names in source comments and strings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'promptframe-cli-security-policy-ast-false-positive-'));
  try {
    const componentDir = path.join(dir, 'component');
    await writeFixtureComponent(componentDir);
    await writeFile(path.join(componentDir, 'src/Component.tsx'), [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      '// Do not use BroadcastChannel in marketplace components.',
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      "  const label = 'BroadcastChannel is blocked by PromptFrame policy';",
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }}>{label}</AbsoluteFill>;',
      '}',
    ].join('\n'));

    const validate = JSON.parse((await execFileAsync('node', [
      cliPath,
      'validate',
      componentDir,
      '--json',
    ])).stdout);
    assert.equal(validate.command, 'validate');
    assert.equal(validate.diagnostic.code, 'validate.completed');
    assert.equal(validate.securityEvaluatorMode, 'ast');
    assert.match(validate.securityPolicyDigest, /^component-security-policy-digest\.v0\.1:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createServer(handler) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 500;
      writeJson(res, { success: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function writeJson(res, payload) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function zipEntryNames(zip) {
  const names = [];
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    names.push(zip.subarray(nameStart, nameStart + nameLength).toString('utf8').replace(/\\/g, '/'));
    offset = dataEnd;
  }
  return names;
}

async function writeFixtureComponent(componentDir) {
  await writeFileTree(componentDir, {
    'package.json': JSON.stringify({
      name: 'fixture-component',
      version: '0.1.0',
      dependencies: {
        '@promptframe/contracts': '^0.1.5',
        '@promptframe/component-kit': '^0.1.6',
      },
      devDependencies: {
        '@promptframe/cli': '^0.1.10',
      },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    'manifest.json': JSON.stringify({
      schemaVersion: 'component-manifest.v0.1.0',
      standardVersion: 'component-standard.v0.1.0',
      standardSourceHash: `sha256:${'0'.repeat(64)}`,
      id: '@demo/fixture-component',
      name: 'fixture-component',
      displayName: 'Fixture Component',
      version: '0.1.0',
      componentType: 'scene_template',
      author: { id: 'demo', name: 'Demo' },
      description: 'Fixture component used by CLI package tests.',
      tags: ['fixture'],
      designedDurationRange: { min: 30, max: 120 },
      layout: fixtureLayoutCapability(),
      entry: {
        sourcePath: 'src/Component.tsx',
        componentExport: 'default',
        propsSchemaPath: 'src/schema.ts',
        sourceHash: `sha256:${'1'.repeat(64)}`,
        schemaHash: `sha256:${'2'.repeat(64)}`,
      },
      dependencies: {},
      peerDependencies: {},
      assets: {},
      capabilityHints: [],
      reviewStatus: 'draft',
      license: 'MIT',
      createdAt: '2026-05-19T00:00:00.000Z',
    }),
    'src/Component.tsx': [
      "import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';",
      'export default function Component() {',
      '  useCurrentFrame();',
      '  useVideoConfig();',
      '  return <AbsoluteFill style={{ width: "100%", height: "100%" }} />;',
      '}',
    ].join('\n'),
    'src/schema.ts': 'export const schema = {};\n',
    'src/index.ts': 'export { default } from "./Component";\n',
    'src/preview-props.json': JSON.stringify({ durationFrames: 60, fps: 30, width: 1280, height: 720, props: {} }),
  });
}

function fixtureLayoutCapability() {
  return {
    contractVersion: 'layout-capability.v0.1.0',
    recommendedSlot: 'full_screen',
    minReadableSize: {
      width: 320,
      height: 180,
    },
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    layoutAdaptivity: 'responsive',
    overflowPolicy: 'fit',
    safeAreaPolicy: 'recommended',
    confidence: 0.8,
  };
}

async function writeWorkspaceFixtureComponent(componentDir, componentId) {
  await writeFixtureComponent(componentDir);
  const manifestPath = path.join(componentDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const slug = componentId.split('/').at(-1);
  manifest.id = componentId;
  manifest.name = slug;
  manifest.displayName = slug.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeFileTree(root, files) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, `${content}\n`);
  }
}
