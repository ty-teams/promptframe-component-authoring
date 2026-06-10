# @promptframe/cli

PromptFrame component authoring CLI.

Use it to inspect the public component standard, check component folders, validate manifests, inspect the local preview envelope, package source archives, upload components, check build status, rebuild evidence indexes, and rerun layout/security probes.

Current npm registry baseline remains `@promptframe/cli@0.1.20` and `create-promptframe-component@0.1.11` until Trusted Publishing completes. The source tree prepares `@promptframe/cli@0.1.21` and `create-promptframe-component@0.1.12`; do not treat those source candidates as registry-available behavior until the official npm registry confirms the release.

```bash
npm install -D @promptframe/cli
npx promptframe dev .
npx promptframe check .
npx promptframe validate .
npx promptframe preview .
npx promptframe preview . --write-local-report --json
npx promptframe package . --out ./component.zip
npx promptframe login --endpoint https://your-promptframe.example/api-proxy
npx promptframe whoami
npx promptframe upload ./component.zip --endpoint https://your-promptframe.example/api-proxy
npx promptframe upload ./component.zip --target project_private_generation --endpoint https://your-promptframe.example/api-proxy
npx promptframe status <buildId> --endpoint https://your-promptframe.example/api-proxy
npx promptframe logout
```

Endpoint resolution is explicit and public-safe:

1. `--endpoint`
2. `PROMPTFRAME_API_BASE`
3. `REMOTION_MEDIA_API_BASE`
4. local config written by `promptframe configure --endpoint <url>`

The CLI embeds no production, Tailscale, local Docker, or private PromptFrame endpoint default. `dev .` starts the component template's local Vite preview shell. `check .` runs the local public policy checks, reports standard freshness for the selected upload lane, and emits deterministic `localReusability` diagnostics so low-reuse marketplace submissions are visible before upload. If no platform endpoint is available, `dev` / `check` return `standard.freshness.offline_degraded` as a warning instead of pretending the online standard was verified. `preview .` reads `src/preview-props.json` and reports the local preview envelope; `preview . --write-local-report` also validates saved `.promptframe/local-previews/*.json` cases and writes `.promptframe/local-previews/preview-report.json` for local author evidence. Neither command runs a custom runtime or replaces the platform iframe preview/render pipeline. Upload success only means the platform accepted the source package for trust-pipeline admission; use `status`, `reindex`, and `probe` to inspect build readiness, evidence/search readiness, and layout/security diagnostics.

Formal platform endpoints use bearer authentication. `promptframe login --endpoint <url>` starts a one-time browser login code flow through `/cli/auth/device/start`: open the printed URL, approve the code in an already signed-in PromptFrame browser session, and the CLI polls `/cli/auth/device/poll` until it receives a short-lived human CLI token. The token secret is stored only in the local PromptFrame config file with `0600` permissions and is never printed to stdout or JSON output. `promptframe login --endpoint <url> --token <token>` remains supported for already issued CLI/CI tokens and verifies them through `/cli/auth/whoami`; `promptframe whoami` shows the current platform identity without printing the token secret; `promptframe logout` revokes the current token and clears the matching local credential. Dev-header flags such as `--auth-roles` and `--auth-permissions` are local smoke helpers only and are rejected before transport for formal non-local endpoints.

`upload` defaults to `--target marketplace_authoring`, the external authoring lane. `--target marketplace --strict` is accepted as the public strict authoring alias and resolves to the same lane. Director Component Author jobs must use `--target project_private_generation` so the server can keep the component project scoped. Unknown targets fail locally before network transport with diagnostic code `upload.target.invalid`; stale PromptFrame authoring package floors are checked before network transport for both component folders and source zip archives. Upload also checks the platform `/components/standard` source hash before sending the package bytes; stale local standards fail with `standard.freshness.upload_blocking`. The platform repeats the same admission checks and remains the final authority.

`setup-ci --provider github` writes `.github/workflows/promptframe-component.yml` for a component project. Pull requests run check-only diagnostics and GitHub annotations; `main` and release-style tag pushes upload with `${{ secrets.PROMPTFRAME_CI_TOKEN }}` against `${{ vars.PROMPTFRAME_API_BASE }}`. Add those values in GitHub repository settings. Do not paste the CI token into the workflow, README, issue, or component source.

For external CodingAI, the feedback order is: local CLI JSON diagnostics, GitHub Check annotations, Action summary, artifact report, then platform `status` / admission diagnostics. The CLI never needs internal PromptFrame REQ/TASK/QA docs, agent boards, private endpoint defaults, Auth0 subjects, cookies, or token secrets.

Local and remote commands support stable JSON output:

```bash
npx promptframe standard --json
npx promptframe doctor . --json
npx promptframe validate . --json
npx promptframe check . --target marketplace_authoring --json
npx promptframe upgrade . --dry-run --json
npx promptframe dev . --dry-run --json
npx promptframe preview . --json
npx promptframe preview . --write-local-report --json
npx promptframe login --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe whoami --json
npx promptframe upload ./component.zip --endpoint "$PROMPTFRAME_API_BASE" --json
npx promptframe status <buildId> --json
npx promptframe reindex <buildId> --provider-kind cloud_embedding --json
npx promptframe probe <buildId> --level standard --json
npx promptframe logout --json
```

Every JSON response includes a stable `diagnostic.code`, for example `standard.completed`, `doctor.completed`, `validate.completed`, `check.completed`, `upgrade.dry_run`, `dev.ready`, `preview.ready`, `preview.local_report.written`, `login.completed`, `whoami.completed`, `logout.completed`, `upload.completed`, `status.completed`, `reindex.completed`, or `probe.completed`. `validate --json` and `check --json` report `checkedRuleIds` for the public policy checks they ran. `upgrade --dry-run --json` reports package floor changes without writing files. `dev --dry-run --json` reports the local preview command without starting a long-running process. JSON failures include `failureReason` and `retryable`. Missing endpoint failures exit with code `2` and use `<command>.endpoint.missing`; missing credentials use `cli.auth.login_required`.

`standard --json` also returns `authoringStandardRelease` and `freshness`. These fields are the public SSOT for package floors, upload targets, standard source hash, and local freshness decisions:

- `marketplace_authoring`: external authoring lane; upload still enters the trust pipeline and public publishing requires review.
- `project_private_generation`: Director Component Author lane; upload still enters the trust pipeline but stays project scoped.
- `freshness.status`: `current`, `warning`, `upload_blocking`, or `security_breaking`.

`validate` and `package` consume public policies from `@promptframe/contracts`: required files, preview limits, deterministic frame-driven source rules, and deterministic security gate patterns such as `code.eval`, `code.new_function`, `code.string_timer`, and `host.fs_process_env`. These local checks are early author feedback; the platform admission pipeline remains the final trust gate.
