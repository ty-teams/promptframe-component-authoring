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

## Local Checks

```bash
pnpm install --frozen-lockfile
pnpm lint:public
pnpm --filter @promptframe/cli test
pnpm --filter @promptframe/component-kit test
pnpm --filter @promptframe/component-kit lint
pnpm --filter @promptframe/component-kit build
cd packages/component-kit && npm pack --dry-run --json
```

## Releases

PromptFrame authoring packages are published to the public npm registry. Releases are signed through npm Trusted Publishing from GitHub Actions.

Release configuration for the currently published SDK:

- npm package: `@promptframe/component-kit`
- GitHub repo: `ty-teams/promptframe-component-authoring`
- Workflow file: `publish-component-kit.yml`
- Environment: `npm-production`

To publish a new version, bump the package version, run local checks, push a `component-kit-vX.Y.Z` tag, and verify npm registry output after the workflow completes.

`@promptframe/contracts`, `@promptframe/cli`, and `create-promptframe-component` start functional releases at `0.1.0`.
