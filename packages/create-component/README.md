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
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe setup-ci . --provider github --workspace
```

The generated workspace writes `promptframe-workspace.json`, a root `package.json`, and `pnpm-workspace.yaml`. Use this mode only when the repository intentionally owns multiple independent components; otherwise keep one component per repository.

Use `--force` only when intentionally refreshing template files in an existing target directory.
