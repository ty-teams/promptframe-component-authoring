import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { componentSourceWorkspaceSchema, type ComponentSourceWorkspace } from '@promptframe/contracts/source-layout';
import { PromptFrameCliError } from './cli-error.js';

type Entry = ComponentSourceWorkspace['components'][number];
type Job = { componentId: string; componentPath: string; artifactName: string };
type Event = {
  name: string;
  ref?: string;
  before?: string;
  component?: string;
  upload?: boolean;
};

const workspaceFile = 'promptframe-workspace.json';
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const locks = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']);
const controls = new Set([...locks, 'package.json', 'pnpm-workspace.yaml', '.npmrc', '.gitignore']);

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

function inside(file: string, dir: string): boolean {
  return file === dir || file.startsWith(dir + '/');
}

function slug(entry: Entry): string {
  return entry.id.slice(entry.id.lastIndexOf('/') + 1);
}

function job(entry: Entry): Job {
  return {
    componentId: entry.id,
    componentPath: entry.path,
    artifactName: createHash('sha256').update(entry.id).digest('hex').slice(0, 24),
  };
}

function selection(check: Entry[], upload: Entry[], reason: string) {
  return { matrix: { include: check.map(job) }, uploadMatrix: { include: upload.map(job) }, reason };
}

function previousWorkspace(raw: string): ComponentSourceWorkspace | undefined {
  try {
    const parsed = componentSourceWorkspaceSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch { /* An unreadable baseline is check-only. */ }
  return undefined;
}

function safelyMoved(root: string, base: string, previous: Entry, current: Entry): boolean {
  // A shared source layout embeds the path. An inherited lock also records
  // relative paths. Only a path-independent tree with its own lock can qualify.
  const oldTree = git(root, ['rev-parse', '--verify', `${base}:${previous.path}`])?.trim();
  const newTree = git(root, ['rev-parse', '--verify', `HEAD:${current.path}`])?.trim();
  if (!oldTree || oldTree !== newTree) return false;
  const tree = git(root, ['ls-tree', '-z', newTree]);
  if (!tree) return false;
  return tree.split('\0').some((line) => {
    const [mode, name] = line.split('\t', 2);
    return mode?.startsWith('100') && name !== undefined && locks.has(name);
  });
}

export function selectWorkspaceCi(root: string, config: ComponentSourceWorkspace, event: Event) {
  const current = config.components;
  if (event.name === 'workflow_dispatch') {
    const requested = event.component?.trim();
    if (!requested && !event.upload) return selection(current, [], 'manual_check_all');
    const exact = current.find(entry => entry.id === requested);
    const matches = exact ? [exact] : current.filter(entry => slug(entry) === requested);
    if (matches.length !== 1) {
      throw new PromptFrameCliError('Select a single registered component using its full ID.', 'workspace.ci.component_required', 2);
    }
    return selection(matches, event.upload ? matches : [], 'manual_component');
  }

  const tag = event.ref?.startsWith('refs/tags/') ? event.ref.slice('refs/tags/'.length) : undefined;
  if (event.name === 'push' && tag) {
    const match = current.filter(entry => {
      if (!tag.startsWith(`component-${slug(entry)}-v`)) return false;
      const manifest = JSON.parse(readFileSync(join(root, entry.path, 'manifest.json'), 'utf8'));
      return tag === `component-${slug(entry)}-v${manifest.version}`;
    });
    return match.length === 1 ? selection(match, match, 'component_tag') : selection(current, [], 'unscoped_tag_check_only');
  }

  const base = event.before;
  if (!base || !commitPattern.test(base) || /^0+$/.test(base) || git(root, ['rev-parse', '--show-prefix'])?.trim() !== '') {
    return selection(current, [], 'unknown_base_check_only');
  }
  const diff = git(root, ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD', '--']);
  const raw = git(root, ['show', `${base}:${workspaceFile}`]);
  const previous = raw === undefined ? undefined : previousWorkspace(raw);
  if (diff === undefined || !previous) return selection(current, [], 'unknown_base_check_only');

  const paths = diff.split('\0').filter(Boolean);
  const previousById = new Map(previous.components.map(entry => [entry.id, entry]));
  const componentPaths = [...previous.components, ...current].map(entry => entry.path);
  const shared = [...(previous.sharedDirectories ?? []), ...(config.sharedDirectories ?? [])];
  const globalChange = JSON.stringify(previous.sharedDirectories) !== JSON.stringify(config.sharedDirectories)
    || paths.some(file => shared.some(dir => inside(file, dir))
      || (controls.has(posix.basename(file)) && !componentPaths.some(dir => inside(file, dir))));
  const workflowChange = paths.some(file => inside(file, '.github/workflows'));
  const check: Entry[] = [], upload: Entry[] = [];
  for (const entry of current) {
    const prior = previousById.get(entry.id);
    const moved = prior !== undefined && prior.path !== entry.path;
    const changed = paths.some(file => inside(file, entry.path) || (prior && inside(file, prior.path)));
    if (globalChange || workflowChange || !prior || moved || changed) check.push(entry);
    const equivalentMove = !globalChange && moved && config.sharedDirectories === undefined
      && previous.sharedDirectories === undefined && safelyMoved(root, base, prior, entry);
    if (event.name === 'push' && !equivalentMove && (globalChange || !prior || moved || changed)) upload.push(entry);
  }
  return selection(check, upload, 'git_diff');
}
