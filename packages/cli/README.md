# @promptframe/cli

PromptFrame component authoring CLI.

Use it to inspect the public component standard, check component folders, validate manifests, inspect the local Remotion preview envelope, package source archives, upload components, check build status, rebuild evidence indexes, and rerun layout/security probes.

```bash
npm install -D @promptframe/cli
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe package . --out ./component.zip
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe upload ./component.zip --target project_private_generation --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
```

Endpoint resolution is explicit and public-safe:

1. `--endpoint`
2. `PROMPTFRAME_API_BASE`
3. `REMOTION_MEDIA_API_BASE`
4. local config written by `promptframe configure --endpoint <url>`

The CLI embeds no production, Tailscale, local Docker, or private PromptFrame endpoint default. `dev .` starts the component template's local Vite preview shell with Remotion Player. `check .` runs the local public policy checks and reports standard freshness for the selected upload lane. `preview .` reads `src/preview-props.json` and reports the local Remotion preview envelope; neither command runs a custom runtime or replaces the platform iframe preview/render pipeline. Upload success only means the platform accepted the source package for trust-pipeline admission; use `status`, `reindex`, and `probe` to inspect build readiness, evidence/search readiness, and layout/security diagnostics.

`upload` defaults to `--target marketplace_authoring`, the external authoring lane. Director Component Author jobs must use `--target project_private_generation` so the server can keep the component project scoped. Unknown targets fail locally before network transport with diagnostic code `upload.target.invalid`; stale PromptFrame authoring package floors are checked before network transport for both component folders and source zip archives. Upload also checks the platform `/components/standard` source hash before sending the package bytes; stale local standards fail with `standard.freshness.upload_blocking`. The platform repeats the same admission checks and remains the final authority.

Local and remote commands support stable JSON output:

```bash
npx promptframe standard --json
npx promptframe doctor . --json
npx promptframe validate . --json
npx promptframe check . --target marketplace_authoring --json
npx promptframe upgrade . --dry-run --json
npx promptframe dev . --dry-run --json
npx promptframe preview . --json
npx promptframe upload ./component.zip --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe status <buildId> --json
npx promptframe reindex <buildId> --provider-kind cloud_embedding --json
npx promptframe probe <buildId> --level standard --json
```

Every JSON response includes a stable `diagnostic.code`, for example `standard.completed`, `doctor.completed`, `validate.completed`, `check.completed`, `upgrade.dry_run`, `dev.ready`, `preview.ready`, `upload.completed`, `status.completed`, `reindex.completed`, or `probe.completed`. `validate --json` and `check --json` report `checkedRuleIds` for the public policy checks they ran. `upgrade --dry-run --json` reports package floor changes without writing files. `dev --dry-run --json` reports the Remotion Player dev command without starting a long-running process. JSON failures include `failureReason` and `retryable`. Missing endpoint failures exit with code `2` and use `<command>.endpoint.missing`.

`standard --json` also returns `authoringStandardRelease` and `freshness`. These fields are the public SSOT for package floors, upload targets, standard source hash, and local freshness decisions:

- `marketplace_authoring`: external authoring lane; upload still enters the trust pipeline and public publishing requires review.
- `project_private_generation`: Director Component Author lane; upload still enters the trust pipeline but stays project scoped.
- `freshness.status`: `current`, `warning`, `upload_blocking`, or `security_breaking`.

`validate` and `package` consume public policies from `@promptframe/contracts`: required files, preview limits, deterministic Remotion source rules, and deterministic security gate patterns such as `code.eval`, `code.new_function`, `code.string_timer`, and `host.fs_process_env`. These local checks are early author feedback; the platform admission pipeline remains the final trust gate.
