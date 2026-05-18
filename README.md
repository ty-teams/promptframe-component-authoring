# PromptFrame Component Authoring

Public source repository for PromptFrame component authoring tools.

Current packages:

- `@promptframe/component-kit`: small TypeScript helper package for building PromptFrame-compatible Remotion components.
- `@promptframe/contracts`: placeholder for public component authoring contracts.
- `@promptframe/cli`: placeholder for component validation, packaging and upload commands.
- `create-promptframe-component`: placeholder for project scaffolding.

```bash
npm install @promptframe/component-kit
```

The package provides version stamps, preview constraints, and deterministic timing helpers. Component projects can depend on it during authoring; finished components are packaged and uploaded with the PromptFrame CLI.

## Local Checks

```bash
pnpm install --frozen-lockfile
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

The `0.0.0` releases for `@promptframe/contracts`, `@promptframe/cli`, and `create-promptframe-component` are placeholders that reserve names and publishing routes. Their functional releases will start at `0.1.0`.
