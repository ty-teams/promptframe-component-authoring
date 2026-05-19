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
npx create-promptframe-component ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe package . --out ./component.zip
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
```

The CLI never embeds a production/private endpoint default. Use `--endpoint`, `PROMPTFRAME_API_BASE`, `REMOTION_MEDIA_API_BASE`, or `promptframe configure --endpoint <url>`. `dev .` starts the template's local Vite preview shell with Remotion Player; `check .` validates the component and reports public standard freshness; `preview .` is a local Remotion preview envelope check. Neither command replaces the platform iframe preview or render pipeline. Upload success means the platform accepted the source package for trust-pipeline admission; search, preview, render, and publish readiness are reported later by platform status/evidence/probe diagnostics.

For automation, add `--json` to `standard`, `doctor`, `validate`, `check`, `upgrade`, `preview`, `upload`, `status`, `reindex`, or `probe`. `dev --dry-run --json` reports the local Remotion Player dev command without starting a long-running server. JSON output includes stable `diagnostic.code`; validation/check output includes `checkedRuleIds`, and JSON failures include `failureReason` plus `retryable`.

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

Current registry baseline: `@promptframe/contracts@0.1.5`, `@promptframe/component-kit@0.1.6`, `@promptframe/cli@0.1.14`, `create-promptframe-component@0.1.7`. `@promptframe/contracts@0.1.5` exposes the public authoring standard release, upload target policy, and freshness decision schema. `@promptframe/component-kit@0.1.6` sources its public standard stamp and style helper contract from `@promptframe/contracts`; `@promptframe/cli@0.1.14` includes `check` / `upgrade` lifecycle diagnostics, blocks stale PromptFrame authoring package floors before network upload for both folders and source zip archives, checks the platform standard source hash before sending package bytes, and reports offline degraded freshness for `dev` / `check` when no platform endpoint is available; `create-promptframe-component@0.1.7` scaffolds templates that use current public package ranges, include a Remotion Player local preview shell, and support explicit `--name` / `--force` for legacy wrapper compatibility.

Before publishing, the platform repo should verify the local authoring source through its `pnpm authoring:link-local` gate. After publishing, it should switch back with `pnpm authoring:use-registry` and verify the real npm packages from `https://registry.npmjs.org/`; npm mirrors can lag new versions.
