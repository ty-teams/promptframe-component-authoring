import {
  COMPONENT_STANDARD_SOURCE_HASH,
  COMPONENT_STANDARD_VERSION,
  PROMPTFRAME_AUTHORING_STANDARD_RELEASE,
  type AuthoringStandardFreshnessDecision,
  type AuthoringUploadTarget,
} from '@promptframe/contracts';

export type CliDiagnostic = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type PackageDependencySet = 'dependencies' | 'devDependencies';

export type ComponentPackageJson = Record<string, unknown> & {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

export type PackageChange = {
  name: string;
  dependencySet: PackageDependencySet;
  current?: string;
  next: string;
  action: 'add' | 'update';
};

export function buildFreshnessDecision(
  target: AuthoringUploadTarget,
  diagnostic: CliDiagnostic,
): AuthoringStandardFreshnessDecision {
  return {
    status: 'current',
    target,
    localStandardVersion: COMPONENT_STANDARD_VERSION,
    localStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    currentStandardVersion: COMPONENT_STANDARD_VERSION,
    currentStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    minPackageVersions: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions,
    diagnostic,
    retryable: false,
  };
}

export function computePackageChanges(packageJson: ComponentPackageJson): PackageChange[] {
  const floors = PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions;
  const requirements: Array<{ name: string; next: string; dependencySet: PackageDependencySet }> = [
    { name: '@promptframe/contracts', next: `^${floors.contracts}`, dependencySet: 'dependencies' },
    { name: '@promptframe/component-kit', next: `^${floors.componentKit}`, dependencySet: 'dependencies' },
    { name: '@promptframe/cli', next: `^${floors.cli}`, dependencySet: 'devDependencies' },
  ];
  if (hasDependency(packageJson, 'create-promptframe-component')) {
    requirements.push({
      name: 'create-promptframe-component',
      next: `^${floors.createComponent}`,
      dependencySet: 'devDependencies',
    });
  }
  return requirements.flatMap((requirement) => {
    const current = findDependency(packageJson, requirement.name);
    const dependencySet = current?.dependencySet ?? requirement.dependencySet;
    if (current && !isBelowRequiredRange(current.version, requirement.next)) return [];
    return [{
      name: requirement.name,
      dependencySet,
      current: current?.version,
      next: requirement.next,
      action: current ? 'update' : 'add',
    }];
  });
}

export function applyPackageChanges(
  packageJson: ComponentPackageJson,
  changes: PackageChange[],
): ComponentPackageJson {
  const next: ComponentPackageJson = JSON.parse(JSON.stringify(packageJson)) as ComponentPackageJson;
  for (const change of changes) {
    const dependencies = {
      ...(asStringMap(next[change.dependencySet]) ?? {}),
      [change.name]: change.next,
    };
    next[change.dependencySet] = sortObject(dependencies);
  }
  return next;
}

export function resolveLocalPreviewScript(packageJson: ComponentPackageJson): string {
  const scripts = asStringMap(packageJson.scripts);
  return scripts?.['preview:serve'] ? 'preview:serve' : 'dev';
}

export function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') output[key] = item;
  }
  return output;
}

function hasDependency(packageJson: ComponentPackageJson, name: string): boolean {
  return Boolean(findDependency(packageJson, name));
}

function findDependency(
  packageJson: ComponentPackageJson,
  name: string,
): { dependencySet: PackageDependencySet; version: string } | undefined {
  for (const dependencySet of ['dependencies', 'devDependencies'] as const) {
    const dependencies = asStringMap(packageJson[dependencySet]);
    const version = dependencies?.[name];
    if (version) return { dependencySet, version };
  }
  return undefined;
}

function isBelowRequiredRange(current: string, required: string): boolean {
  const currentVersion = parseLooseSemver(current);
  const requiredVersion = parseLooseSemver(required);
  if (!currentVersion || !requiredVersion) return current !== required;
  for (let index = 0; index < requiredVersion.length; index += 1) {
    if (currentVersion[index] < requiredVersion[index]) return true;
    if (currentVersion[index] > requiredVersion[index]) return false;
  }
  return false;
}

function parseLooseSemver(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function sortObject(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}
