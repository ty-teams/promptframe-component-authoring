# create-promptframe-component

Create a PromptFrame-compatible video component project from the standard React template.

The generated project has no Git remote by default. It is meant to be validated and uploaded through `@promptframe/cli`.

```bash
npx create-promptframe-component ./my-component --name my-component --display-name "My Component"
```

Advanced teams can scaffold an explicit multi-component workspace:

```bash
npx create-promptframe-component ./component-workspace \
  --workspace \
  --component image-particle-remotion \
  --display-name "Image Particle Remotion"
cd component-workspace
pnpm install
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe setup-ci . --provider github --workspace
```

The generated workspace writes `promptframe-workspace.json`, a root `package.json`, and `pnpm-workspace.yaml`. Run `pnpm install` at the workspace root before `check` or `upload` so the shared pnpm lockfile is available as dependency evidence. Use this mode only when the repository intentionally owns multiple independent components; otherwise keep one component per repository.

Running the same `--workspace` command against an existing workspace appends the new component and merges root files. It preserves existing component registrations and root package scripts, and CI workflows stay managed from the repository root through `promptframe setup-ci . --provider github --workspace`.

Use `--force` only when intentionally refreshing template files in an existing target directory.
