# PromptFrame Component Authoring

Public source repository for PromptFrame component authoring tools.

Current packages:

- `@promptframe/component-kit`: small TypeScript helper package for building PromptFrame-compatible video components.
- `@promptframe/contracts`: public component authoring contracts.
- `@promptframe/cli`: component validation, packaging and upload commands.
- `create-promptframe-component`: project scaffolding for component authors.

```bash
npm install @promptframe/component-kit
npm install -D @promptframe/cli create-promptframe-component
```

The package provides version stamps, preview constraints, and deterministic timing helpers. Component projects can depend on it during authoring; finished components are packaged and uploaded with the PromptFrame CLI.

Typical author flow:

```bash
npx create-promptframe-component ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe preview . --write-local-report --json
npx promptframe package . --out ./component.zip
npx promptframe login --endpoint https://your-promptframe.example/api-proxy --token "$PROMPTFRAME_CLI_TOKEN"
npx promptframe whoami
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
npx promptframe logout
```

The CLI never embeds a production/private endpoint default. Use `--endpoint`, `PROMPTFRAME_API_BASE`, `REMOTION_MEDIA_API_BASE`, or `promptframe configure --endpoint <url>`. Formal platform endpoints use bearer auth from `promptframe login`, `PROMPTFRAME_CI_TOKEN`, or `PROMPTFRAME_CLI_TOKEN`; local dev-header flags are only for local smoke endpoints and are rejected for formal non-local endpoints. `dev .` starts the template's local video preview shell; `check .` validates the component and reports public standard freshness; `preview .` is a local preview envelope check; `preview . --write-local-report` writes `.promptframe/local-previews/preview-report.json` from canonical and saved local preview cases. Neither command replaces the platform iframe preview or render pipeline. Upload success means the platform accepted the source package for trust-pipeline admission; search, preview, render, and publish readiness are reported later by platform status/evidence/probe diagnostics.

For automation, add `--json` to `standard`, `doctor`, `validate`, `check`, `upgrade`, `preview`, `login`, `whoami`, `logout`, `upload`, `status`, `reindex`, or `probe`. `dev --dry-run --json` reports the local preview command without starting a long-running server. `preview --write-local-report --json` reports `preview.local_report.written`. JSON output includes stable `diagnostic.code`; validation/check output includes `checkedRuleIds`, and JSON failures include `failureReason` plus `retryable`.

GitHub Actions setup:

```bash
npx promptframe setup-ci --provider github
```

This writes `.github/workflows/promptframe-component.yml`. Pull requests run `promptframe check . --json` and publish GitHub annotations / summary only; `main` and release-style tag pushes run `promptframe upload .`. Configure repository variable `PROMPTFRAME_API_BASE` and secret `PROMPTFRAME_CI_TOKEN` in GitHub. The generated workflow references only those names and does not write token values or private endpoints into the repo.

External CodingAI should read local CLI JSON diagnostics, GitHub Check annotations, Action summary, artifact report, and platform status/admission diagnostics. It must not read PromptFrame internal REQ/TASK/QA docs, agent boards, deployment scripts, private endpoints, or token secrets.

## Local Checks

```bash
pnpm install --frozen-lockfile
pnpm lint:public
pnpm -r test
pnpm -r build
pnpm -r lint
pnpm -r pack:dry-run
```

## Releases

PromptFrame authoring packages are published to the public npm registry. Releases are signed through npm Trusted Publishing from GitHub Actions.

Release configuration:

- GitHub repo: `ty-teams/promptframe-component-authoring`
- Environment: `npm-production`
- `@promptframe/component-kit`: workflow `publish-component-kit.yml`, tag `component-kit-vX.Y.Z`
- `@promptframe/contracts`: workflow `publish-contracts.yml`, tag `contracts-vX.Y.Z`
- `@promptframe/cli`: workflow `publish-cli.yml`, tag `cli-vX.Y.Z`
- `create-promptframe-component`: workflow `publish-create-component.yml`, tag `create-component-vX.Y.Z`

To publish a new version, bump the package version, run local checks, push the matching package tag, and verify npm registry output after the workflow completes. Do not publish from a local npm token path for normal releases.

Current npm registry baseline remains `@promptframe/contracts@0.1.8`, `@promptframe/component-kit@0.1.7`, `@promptframe/cli@0.1.20`, and `create-promptframe-component@0.1.11`. `@promptframe/contracts@0.1.8` exposes the public authoring standard release, upload target policy, freshness decision schema, component reusability score schema, style intent contract, `component.style.unknown_custom_style_prop` helper for detecting root-level private style props, and the public dependency policy contract for marketplace admission diagnostics. `@promptframe/component-kit@0.1.7` sources its public standard stamp and style helper contract from `@promptframe/contracts`, and exposes `createPreviewCaseMatrix()` for bounded local preview aspect / props stress cases; `@promptframe/cli@0.1.20` includes `check` / `upgrade` lifecycle diagnostics, blocks stale PromptFrame authoring package floors before network upload for both folders and source zip archives, checks the platform standard source hash before sending package bytes, reports offline degraded freshness for `dev` / `check` when no platform endpoint is available, returns `localReusability` and dependency policy diagnostics from `check` and directory `upload`, reports unknown root-level private style props from `validate` / `check`, can forward explicit dev-header auth roles / permissions to guarded local platform endpoints, writes local preview reports from canonical and saved local preview cases, and ignores package manager lockfiles during source safety scans and source package creation. The source tree prepares `@promptframe/contracts@0.1.9` with a public security policy digest and AST-aware security evaluator subpath; it prepares `@promptframe/cli@0.1.21` with first-stage bearer auth, browser login code flow, `whoami` / `logout`, formal-endpoint dev-header rejection, GitHub workflow setup, and source validation backed by the contracts AST security evaluator with `securityPolicyDigest` / `securityEvaluatorMode` JSON output; it prepares `create-promptframe-component@0.1.12` to update the scaffolded template to `@promptframe/cli@^0.1.21`. Publish these packages through Trusted Publishing before treating that behavior as a registry baseline.

Before publishing, the platform repo should verify the local authoring source through its `pnpm authoring:link-local` gate. After publishing, it should switch back with `pnpm authoring:use-registry` and verify the real npm packages from `https://registry.npmjs.org/`; npm mirrors can lag new versions.
