#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targetArg = process.argv[2];
if (!targetArg || targetArg === '--help' || targetArg === '-h') {
  console.log('Usage: npm create promptframe-component <component-dir> [--name sales-funnel] [--display-name "Sales Funnel"] [--force]');
  console.log('       npm create promptframe-component <workspace-dir> --workspace --component image-particle-remotion [--component-path components/image-particle-remotion] [--id @marketplace/image-particle-remotion]');
  process.exit(targetArg ? 0 : 1);
}

const argv = process.argv.slice(3);
const targetDir = resolve(targetArg);
if (existsSync(targetDir) && readdirSync(targetDir).length > 0 && !hasFlag(argv, '--force')) {
  console.error(`create.target_not_empty: ${targetDir} is not empty`);
  process.exit(1);
}

const componentName = toKebabName(valueAfter(argv, '--name') ?? targetArg.split(/[\\/]/).filter(Boolean).at(-1) ?? 'promptframe-component');
const displayName = valueAfter(argv, '--display-name') ?? toTitle(componentName);
const description = valueAfter(argv, '--description') ?? `${displayName} PromptFrame component`;
const packageRoot = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(packageRoot, '../templates/react-remotion');

if (hasFlag(argv, '--workspace')) {
  createWorkspace(targetDir, argv, templateDir);
} else {
  copyTemplate(templateDir, targetDir, {
    __COMPONENT_NAME__: componentName,
    __DISPLAY_NAME__: displayName,
    __DESCRIPTION__: description,
  });

  console.log(`Created PromptFrame component at ${targetDir}`);
  console.log('Next steps: npm install && npm run validate');
}

function createWorkspace(root: string, argv: string[], templateDir: string): void {
  const workspaceRootName = toKebabName(valueAfter(argv, '--workspace-name') ?? basename(root));
  const workspaceComponentName = toKebabName(valueAfter(argv, '--component') ?? valueAfter(argv, '--name') ?? 'promptframe-component');
  const workspaceDisplayName = valueAfter(argv, '--display-name') ?? toTitle(workspaceComponentName);
  const workspaceDescription = valueAfter(argv, '--description') ?? `${workspaceDisplayName} PromptFrame component`;
  const componentId = valueAfter(argv, '--id') ?? `@marketplace/${workspaceComponentName}`;
  const componentPath = normalizeWorkspaceRelativePath(valueAfter(argv, '--component-path') ?? `components/${workspaceComponentName}`);
  const componentDir = join(root, componentPath);

  copyTemplate(templateDir, componentDir, {
    __COMPONENT_NAME__: workspaceComponentName,
    __DISPLAY_NAME__: workspaceDisplayName,
    __DESCRIPTION__: workspaceDescription,
  });
  writeWorkspaceRootFiles(root, {
    workspaceRootName,
    componentId,
    componentPath,
  });
  writeComponentManifestId(componentDir, componentId);

  console.log(`Created PromptFrame component workspace at ${root}`);
  console.log(`Component: ${componentId} -> ${componentPath}`);
  console.log('Next steps: npm install && npm run check');
}

function writeWorkspaceRootFiles(root: string, options: {
  workspaceRootName: string;
  componentId: string;
  componentPath: string;
}): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: options.workspaceRootName,
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: 'pnpm@10.0.0',
    scripts: {
      check: `promptframe workspace validate . && promptframe check . --workspace-component ${options.componentId}`,
      upload: `promptframe upload . --workspace-component ${options.componentId}`,
      'setup-ci': 'promptframe setup-ci . --provider github --workspace',
    },
    devDependencies: {
      '@promptframe/cli': '^0.1.33',
    },
  }, null, 2)}\n`, 'utf8');
  const workspaceGlobs = [...new Set([workspaceGlobForPath(options.componentPath), 'packages/*'])];
  writeFileSync(join(root, 'pnpm-workspace.yaml'), [
    'packages:',
    ...workspaceGlobs.map((glob) => `  - "${glob}"`),
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'promptframe-workspace.json'), `${JSON.stringify({
    schemaVersion: 'promptframe-workspace.v0.1.0',
    components: [{
      id: options.componentId,
      path: options.componentPath,
    }],
  }, null, 2)}\n`, 'utf8');
}

function writeComponentManifestId(componentDir: string, componentId: string): void {
  const manifestPath = join(componentDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.id = componentId;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function workspaceGlobForPath(componentPath: string): string {
  const topLevel = componentPath.split('/')[0] ?? 'components';
  return `${topLevel}/*`;
}

function normalizeWorkspaceRelativePath(value: string): string {
  const normalized = value
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    console.error(`create.workspace_component_path_invalid: ${value}`);
    process.exit(1);
  }
  return normalized;
}

function copyTemplate(from: string, to: string, replacements: Record<string, string>): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    const stat = statSync(src);
    if (stat.isDirectory()) {
      copyTemplate(src, dest, replacements);
      continue;
    }
    if (isTextFile(src)) {
      let text = readFileSync(src, 'utf8');
      for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(key, value);
      writeFileSync(dest, text);
    } else {
      copyFileSync(src, dest);
    }
  }
}

function isTextFile(path: string): boolean {
  return /\.(json|md|js|ts|tsx|yml|yaml|css|html)$/.test(path);
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function toKebabName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'promptframe-component';
}

function toTitle(value: string): string {
  return value.split('-').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}
