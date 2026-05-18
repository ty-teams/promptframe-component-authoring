# PromptFrame Component Authoring

Public source repository for PromptFrame component authoring tools.

Current packages:

- `@promptframe/component-kit`: small TypeScript helper package for building PromptFrame-compatible Remotion components.
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
npx create-promptframe-component my-component
cd my-component
npm install
npx promptframe validate .
npx promptframe package . --out ./component.zip
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
```

The CLI never embeds a production/private endpoint default. Use `--endpoint`, `PROMPTFRAME_API_BASE`, `REMOTION_MEDIA_API_BASE`, or `promptframe configure --endpoint <url>`. Upload success means the platform accepted the source package for trust-pipeline admission; search, preview, render, and publish readiness are reported later by platform status/evidence/probe diagnostics.

For automation, add `--json` to `standard`, `doctor`, `validate`, `upload`, `status`, `reindex`, or `probe`. JSON output includes stable `diagnostic.code`; validation output includes `checkedRuleIds`, and JSON failures include `failureReason` plus `retryable`.

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

To publish a new version, bump the package version, run local checks, push the matching package tag, and verify npm registry output after the workflow completes.

Current registry baseline: `@promptframe/contracts@0.1.2`, `@promptframe/component-kit@0.1.5`, `@promptframe/cli@0.1.3`, `create-promptframe-component@0.1.1`. `@promptframe/component-kit@0.1.5` sources its public standard stamp from `@promptframe/contracts`.
