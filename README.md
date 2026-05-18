# PromptFrame Component Kit

Public release repository for `@promptframe/component-kit`, the authoring SDK and standards helper for PromptFrame marketplace component authors.

This repository is intentionally thin. It publishes the stable component authoring kit only; marketplace/private components themselves are not distributed through npm. Component source packages and build artifacts still go through PromptFrame CLI upload, admission, security review, evidence indexing and artifact storage.

## Local Checks

```bash
pnpm install --frozen-lockfile
pnpm --filter @promptframe/component-kit test
pnpm --filter @promptframe/component-kit lint
pnpm --filter @promptframe/component-kit build
cd packages/component-kit && npm pack --dry-run --json
```

## Releases

`@promptframe/component-kit` is published to the public npm registry. Releases are signed through npm Trusted Publishing from GitHub Actions.

Release configuration:

- npm package: `@promptframe/component-kit`
- GitHub repo: `ty-teams/promptframe-component-kit`
- Workflow file: `publish-component-kit.yml`
- Environment: `npm-production`

To publish a new version, bump the package version, run local checks, push a `component-kit-vX.Y.Z` tag, and verify npm registry output after the workflow completes.
