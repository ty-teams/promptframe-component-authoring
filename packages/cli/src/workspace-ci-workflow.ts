const expression = (value: string) => '$' + '{{ ' + value + ' }}';

export function workspaceCiWorkflow(header: string, version: string, publicReviewStep: (cli: string, directory: string) => string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid PromptFrame CLI package version for CI.');
  const cli = `npx --yes --package @promptframe/cli@${version} -- promptframe`;
  const uploadDirectory = `${expression('runner.temp')}/promptframe-${expression('github.run_id')}-${expression('github.run_attempt')}-${expression('matrix.artifactName')}`;
  return `${header}

name: PromptFrame Component Workspace

on:
  pull_request:
  push:
    branches: [main]
    tags:
      - 'v*'
      - '**@*'
      - 'component-*'
  workflow_dispatch:
    inputs:
      component:
        description: Registered component ID or unique slug (empty checks all)
        required: false
        type: string
      upload:
        description: Upload the checked component to the configured PromptFrame project
        default: false
        type: boolean

permissions:
  contents: read

jobs:
  discover:
    name: Select PromptFrame components
    runs-on: ubuntu-latest
    outputs:
      matrix: ${expression('steps.select.outputs.matrix')}
      count: ${expression('steps.select.outputs.count')}
      upload_matrix: ${expression('steps.select.outputs.upload_matrix')}
      upload_count: ${expression('steps.select.outputs.upload_count')}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - id: select
        name: Select registered components from the Git event
        shell: bash
        run: |
          set -euo pipefail
          ${cli} workspace ci-select . > "$RUNNER_TEMP/promptframe-selection.json"
          node <<'NODE'
          const fs = require('node:fs');
          const plan = JSON.parse(fs.readFileSync(process.env.RUNNER_TEMP + '/promptframe-selection.json', 'utf8'));
          const fields = {
            matrix: JSON.stringify(plan.matrix),
            count: plan.matrix.include.length,
            upload_matrix: JSON.stringify(plan.uploadMatrix),
            upload_count: plan.uploadMatrix.include.length,
          };
          fs.appendFileSync(process.env.GITHUB_OUTPUT,
            Object.entries(fields).map(([key, value]) => key + '=' + value + '\\n').join(''));
          fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            '### PromptFrame workspace\\nChecks: ' + fields.count + ' · Upload candidates: ' + fields.upload_count +
            ' · Reason: ' + plan.reason + '\\n');
          NODE

  check:
    name: Check and package (${expression('matrix.componentId')})
    needs: discover
    if: needs.discover.outputs.count != '0'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: ${expression('fromJSON(needs.discover.outputs.matrix)')}
    env:
      COMPONENT_ID: ${expression('matrix.componentId')}
      COMPONENT_PATH: ${expression('matrix.componentPath')}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install locked dependencies
        shell: bash
        run: |
          set -euo pipefail
          if [ -f pnpm-lock.yaml ]; then
            npm install -g pnpm@10
            pnpm install --frozen-lockfile
          elif [ -f "$COMPONENT_PATH/package-lock.json" ] || [ -f "$COMPONENT_PATH/npm-shrinkwrap.json" ]; then
            npm ci --prefix "$COMPONENT_PATH"
          elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
            npm ci
          else
            echo "Commit a root pnpm/npm lockfile or a component npm lockfile before running CI."
            exit 1
          fi
      - name: Check and freeze the exact source archive
        shell: bash
        run: |
          set -euo pipefail
          ${cli} check . --workspace-component "$COMPONENT_ID" --json | tee promptframe-check.json
          ${cli} package . --workspace-component "$COMPONENT_ID" --out "$RUNNER_TEMP/component.zip" > "$RUNNER_TEMP/component-source.json"
          (cd "$RUNNER_TEMP" && sha256sum component.zip > component.zip.sha256)
      - uses: actions/upload-artifact@v4
        with:
          name: promptframe-source-${expression('matrix.artifactName')}
          path: |
            ${expression('runner.temp')}/component.zip
            ${expression('runner.temp')}/component.zip.sha256
            ${expression('runner.temp')}/component-source.json
          retention-days: 1
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: promptframe-check-${expression('matrix.artifactName')}
          path: promptframe-check.json
          if-no-files-found: ignore

  upload:
    name: Upload checked archive (${expression('matrix.componentId')})
    needs: [discover, check]
    if: >-
      needs.discover.outputs.upload_count != '0' &&
      (github.event_name == 'push' || github.event_name == 'workflow_dispatch') &&
      (github.ref == 'refs/heads/main' || (github.ref_type == 'tag' && github.ref_protected))
    runs-on: ${expression("vars.RUNNER_LABELS && fromJSON(vars.RUNNER_LABELS) || 'ubuntu-latest'")}
    environment: ${expression("vars.PROMPTFRAME_CI_ENVIRONMENT || 'promptframe-upload'")}
    strategy:
      fail-fast: false
      matrix: ${expression('fromJSON(needs.discover.outputs.upload_matrix)')}
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: actions/download-artifact@v4
        with:
          name: promptframe-source-${expression('matrix.artifactName')}
          path: ${uploadDirectory}
      - name: Upload the verified component archive
        id: upload
        env:
          PROMPTFRAME_API_BASE: ${expression('vars.PROMPTFRAME_API_BASE')}
          PROMPTFRAME_CI_TOKEN: ${expression('secrets.PROMPTFRAME_CI_TOKEN')}
          ARCHIVE_DIR: ${uploadDirectory}
        shell: bash
        run: |
          set -euo pipefail
          test -n "$PROMPTFRAME_API_BASE" || { echo "Configure PROMPTFRAME_API_BASE."; exit 1; }
          test -n "$PROMPTFRAME_CI_TOKEN" || { echo "Configure PROMPTFRAME_CI_TOKEN."; exit 1; }
          trap 'rm -f -- "$ARCHIVE_DIR/component.zip" "$ARCHIVE_DIR/component.zip.sha256" "$ARCHIVE_DIR/component-source.json"' EXIT
          cd "$ARCHIVE_DIR"
          sha256sum --check component.zip.sha256
          PROMPTFRAME_VERSION_NOTES=$(node <<'NODE'
          const fs = require('node:fs');
          const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
          process.stdout.write(String(event.head_commit?.message || process.env.GITHUB_REF_NAME || '')
            .split(/\\r?\\n/g)[0].trim().slice(0, 1000));
          NODE
          )
          ${cli} upload component.zip --workspace-source-receipt component-source.json --target project_private_generation --endpoint "$PROMPTFRAME_API_BASE" --release-notes "$PROMPTFRAME_VERSION_NOTES" --json | tee promptframe-upload.json
          BUILD_ID=$(node -e 'const data = require("./promptframe-upload.json"); const id = data.jobId || data.buildId || data.build?.buildId; if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id || "")) process.exit(1); process.stdout.write(id);')
          printf 'build_id=%s\\n' "$BUILD_ID" >> "$GITHUB_OUTPUT"
          ${cli} status "$BUILD_ID" --wait --endpoint "$PROMPTFRAME_API_BASE" --json --fail-on-build-failed | tee promptframe-status.json
${publicReviewStep(cli, uploadDirectory)}      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: promptframe-upload-${expression('matrix.artifactName')}
          path: |
            ${uploadDirectory}/promptframe-upload.json
            ${uploadDirectory}/promptframe-status.json
          if-no-files-found: ignore
`;
}
