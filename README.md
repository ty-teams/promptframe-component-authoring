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
npx -y create-promptframe-component@latest ./my-component --name my-component --display-name "My Component"
cd my-component
npm install
# pnpm workspace users: pnpm install --ignore-workspace
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe preview . --write-local-report --json
npx promptframe package . --out ./component.zip
npx promptframe login --endpoint https://your-promptframe.example/api-proxy
npx promptframe whoami
npx promptframe discovery
npx promptframe project list
npx promptframe ci-token create --name "GitHub release" --scope component.upload --scope component.status.read --upload-target marketplace_authoring
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
npx promptframe logout
```

The CLI never embeds a production/private endpoint default. Use `--endpoint`, `PROMPTFRAME_API_BASE`, `REMOTION_MEDIA_API_BASE`, or `promptframe configure --endpoint <url>`. Formal platform endpoints use bearer auth from browser code login, `PROMPTFRAME_CI_TOKEN`, or `PROMPTFRAME_CLI_TOKEN`; local dev-header flags are only for local smoke endpoints and are rejected for formal non-local endpoints. `promptframe login --endpoint <url>` starts a browser Device Code flow and stores a short-lived human CLI token locally. `promptframe login --endpoint <url> --token <token>` is for a token that was already issued elsewhere. Do not paste token secrets into source, README files, issues, prompts, or workflow logs.

Identity and project scope come from the platform session or scoped token. External authors should not hand-fill `tenantId`, `userId`, or `projectId`; formal endpoints reject dev identity headers. Use `promptframe whoami` to inspect the current identity, `promptframe discovery` to inspect endpoint capabilities, and `promptframe project list` / `promptframe project current` to inspect accessible projects. Server-side project switching is not a public CLI contract yet, so the CLI does not pretend that local config can override the platform principal. Upload targets are explicit lanes: `marketplace_authoring` is the reusable external marketplace lane, while `project_private_generation` is for project-scoped private component generation. A scoped token may be limited to specific upload targets, and the server is the final authority.

Authors can create project-scoped automation tokens after browser login:

```bash
npx promptframe ci-token create \
  --name "GitHub release" \
  --scope component.upload \
  --scope component.status.read \
  --upload-target marketplace_authoring \
  --json
npx promptframe ci-token list --status active --json
npx promptframe ci-token revoke <tokenId> --reason "rotating release credential" --json
```

`ci-token create` is the only self-service command that returns a token secret, and it is shown once. Store it in a secret manager such as GitHub Actions secrets; do not paste it into source, README files, issues, prompts, or workflow logs.

`dev .` starts the template's local video preview shell; `check .` validates the component and reports public standard freshness; `preview .` is a local preview envelope check; `preview . --write-local-report` writes `.promptframe/local-previews/preview-report.json` from canonical and saved local preview cases. Neither command replaces the platform iframe preview or render pipeline. Upload success means the platform accepted the source package for trust-pipeline admission; search, preview, render, and publish readiness are reported later by platform status/evidence/probe diagnostics.

Component assets should be passed through JSON props, safe fallback defaults, platform-managed asset references, or the component-level `public/` resource contract. Put small images, audio, video, fonts, JSON, or text files under `public/`; `validate`, `check`, `package`, and directory `upload --json` report a `publicResources` summary with path, type, size, and SHA-256 diagnostics. Component code should resolve resources with `promptFramePublicResource(props, '/logo.png', fallback)` from `@promptframe/component-kit`. After platform build admission accepts those files, preview/render receive platform-managed runtime URLs; `status` / build diagnostics remain the final authority for the accepted files, hosted URLs, and any rejection reason. Do not rely on raw external URLs or component-side `fetch()` unless a platform-mediated API explicitly allows it.

The generated local preview shell uses `@remotion/player`, renders object / array props as structured controls with an `Advanced JSON` fallback, and passes `acknowledgeRemotionLicense` so the scaffold does not interrupt local authoring with repeated console prompts. This is only a local preview setting; component authors should still review the Remotion license for their own usage and distribution model.

For automation, add `--json` to `standard`, `doctor`, `validate`, `check`, `upgrade`, `preview`, `login`, `whoami`, `logout`, `upload`, `status`, `reindex`, or `probe`. `dev --dry-run --json` reports the local preview command without starting a long-running server. `preview --write-local-report --json` reports `preview.local_report.written`. JSON output includes stable `diagnostic.code`; validation/check output includes `checkedRuleIds`, and JSON failures include `failureReason` plus `retryable`.

GitHub Actions setup:

```bash
npx promptframe setup-ci --provider github
```

This writes `.github/workflows/promptframe-component.yml`. Pull requests run `promptframe check . --json` and publish GitHub annotations / summary only; `main` and release-style tag pushes run `promptframe upload .`. Configure repository variable `PROMPTFRAME_API_BASE` and secret `PROMPTFRAME_CI_TOKEN` in GitHub. The generated workflow references only those names and does not write token values or private endpoints into the repo.

## Repository Layouts

PromptFrame supports two repository styles. Use the simple one unless you have a real multi-component team workflow.

**Single component repository (recommended default):** the repository root is the component package. It contains `manifest.json`, `package.json`, `src/`, and optional `public/`. Run `promptframe check .`, `promptframe upload .`, and `promptframe setup-ci --provider github` from the root. This is the generated scaffold's default shape and is the easiest path for external authors and CodingAI.

**Multi-component repository / monorepo (advanced):** the repository may contain many independent component packages, but each upload must explicitly name one component entry from `promptframe-workspace.json`. The CI token authorizes the request; it does not tell the platform which component changed. Component identity comes from the selected directory's `manifest.json`, and `promptframe workspace validate` blocks manifest/config mismatches before upload. The platform remains the final authority for project, owner, upload target, and admission checks.

Create an advanced workspace scaffold:

```bash
npx -y create-promptframe-component@latest ./component-workspace \
  --workspace \
  --component image-particle-remotion \
  --display-name "Image Particle Remotion"
cd component-workspace
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe setup-ci . --provider github --workspace
npx promptframe upload . --workspace-component @marketplace/image-particle-remotion --endpoint "$PROMPTFRAME_API_BASE" --json
```

Existing monorepos can opt in by adding `promptframe-workspace.json`:

```json
{
  "schemaVersion": "promptframe-workspace.v0.1.0",
  "components": [
    {
      "id": "@marketplace/image-particle-remotion",
      "path": "components/motion-intro/image-particle-remotion"
    }
  ]
}
```

Then run:

```bash
npx promptframe workspace validate . --json
npx promptframe check . --workspace-component @marketplace/image-particle-remotion --json
npx promptframe upload . --workspace-component @marketplace/image-particle-remotion --endpoint "$PROMPTFRAME_API_BASE" --json
```

The older path-explicit form is still valid when you intentionally work inside one component directory:

```bash
cd components/motion-intro/image-particle-remotion
npx promptframe upload . --endpoint "$PROMPTFRAME_API_BASE" --json
```

Do not run `promptframe upload .` at a monorepo root unless that root is itself a valid single component package. Do not rely on repository names, commit messages, or tag names as the component mapping source. For CI tokens, use `promptframe setup-ci . --provider github --workspace`; it writes a matrix workflow that validates the workspace and uploads each configured component with explicit source metadata headers.

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

Current npm registry baseline is `@promptframe/contracts@0.1.13`, `@promptframe/component-kit@0.1.11`, `@promptframe/cli@0.1.31`, and `create-promptframe-component@0.1.20`. `@promptframe/contracts@0.1.13` exposes the public authoring standard release, upload target policy, freshness decision schema, component reusability score schema, style intent contract, public dependency policy, public resource policy/schema, public security policy digest, and AST-aware security evaluator subpath. `@promptframe/component-kit@0.1.11` sources its public standard stamp and style/resource helper contracts from `@promptframe/contracts`, and exposes `createPreviewCaseMatrix()` plus `promptFramePublicResource()` for runtime resource lookup with local fallback. `@promptframe/cli@0.1.31` includes lifecycle diagnostics, package freshness checks, remote standard source hash checks, local preview reports, bearer login, browser login code flow, `whoami` / `logout`, endpoint discovery, project list/current diagnostics, self-service CI token create/list/revoke, formal-endpoint dev-header rejection, single-component and workspace GitHub workflow setup, `promptframe-workspace.json` validation, source metadata headers for workspace uploads, source validation backed by the contracts AST security evaluator with `securityPolicyDigest` / `securityEvaluatorMode` JSON output, public resource diagnostics, sanitized lockfile evidence packaging for platform admission, and case-sensitive native tag checks so Remotion `<Img>` / `<Video>` are not mistaken for raw browser tags. `create-promptframe-component@0.1.20` scaffolds single-component projects and advanced `--workspace` monorepos with recursive structured complex props controls and Advanced JSON fallback in local preview, current public contracts, and CLI dependency floors.

Before publishing, the platform repo should verify the local authoring source through its `pnpm authoring:link-local` gate. After publishing, it should switch back with `pnpm authoring:use-registry` and verify the real npm packages from `https://registry.npmjs.org/`; npm mirrors can lag new versions.
