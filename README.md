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

## Publishing

`@promptframe/component-kit@0.1.0` has been bootstrapped to npm as a public package. Future releases should use npm Trusted Publishing from GitHub Actions. No `NPM_TOKEN` should be committed or stored for this repository.

Expected trusted publisher fields:

- npm package: `@promptframe/component-kit`
- GitHub repo: `ty-teams/promptframe-component-kit`
- Workflow file: `publish-component-kit.yml`
- Environment: `npm-production`

The `npm-production` GitHub environment is intentionally present so npm Trusted Publishing can bind future releases to this workflow. Do not add an `NPM_TOKEN` secret. To publish the next version, bump the package version, run local checks, push a `component-kit-vX.Y.Z` tag, and verify npm registry output after the workflow completes.
