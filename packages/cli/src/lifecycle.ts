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
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

export type PackageChange = {
  name: string;
  dependencySet: PackageDependencySet;
  current?: string;
  next: string;
  action: 'add' | 'update';
};

export type PackageFreshnessDiagnostic = CliDiagnostic & {
  packageName: string;
  minimum: string;
  current?: string;
  dependencySet?: keyof Pick<ComponentPackageJson, 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'>;
};

export type ScaffoldMetadata = Record<string, unknown> & {
  schemaVersion?: string;
  createdByPackage?: string;
  createdByVersion?: string;
  templateName?: string;
  templateDigest?: string;
  createdAt?: string;
};

export type ScaffoldFreshnessDiagnostic = CliDiagnostic & {
  packageName: 'create-promptframe-component';
  minimum: string;
  current?: string;
  templateName?: string;
  templateDigest?: string;
  expectedTemplateDigest?: string;
  repairHint: string;
};

type PackageFreshnessRule = {
  name: string;
  floorKey: keyof typeof PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions;
  defaultDependencySet: PackageDependencySet;
  requiredForMarketplace: boolean;
  missingCode?: string;
  minVersionCode: string;
};

const packageFreshnessRules: PackageFreshnessRule[] = [
  {
    name: '@promptframe/contracts',
    floorKey: 'contracts',
    defaultDependencySet: 'dependencies',
    requiredForMarketplace: true,
    missingCode: 'component_standard.authoring_package.contracts.missing',
    minVersionCode: 'component_standard.authoring_package.contracts.min_version',
  },
  {
    name: '@promptframe/component-kit',
    floorKey: 'componentKit',
    defaultDependencySet: 'dependencies',
    requiredForMarketplace: true,
    missingCode: 'component_standard.authoring_package.component_kit.missing',
    minVersionCode: 'component_standard.authoring_package.component_kit.min_version',
  },
  {
    name: '@promptframe/cli',
    floorKey: 'cli',
    defaultDependencySet: 'devDependencies',
    requiredForMarketplace: true,
    missingCode: 'component_standard.authoring_package.cli.missing',
    minVersionCode: 'component_standard.authoring_package.cli.min_version',
  },
  {
    name: 'create-promptframe-component',
    floorKey: 'createComponent',
    defaultDependencySet: 'devDependencies',
    requiredForMarketplace: false,
    minVersionCode: 'component_standard.authoring_package.create_component.min_version',
  },
];

export function buildFreshnessDecision(
  target: AuthoringUploadTarget,
  diagnostic: CliDiagnostic,
): AuthoringStandardFreshnessDecision {
  return {
    status: 'current',
    target,
    localStandardVersion: COMPONENT_STANDARD_VERSION,
    localStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    localReleaseId: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.releaseId,
    localReleaseDigest: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.releaseDigest,
    currentStandardVersion: COMPONENT_STANDARD_VERSION,
    currentStandardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
    currentReleaseId: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.releaseId,
    currentReleaseDigest: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.releaseDigest,
    minPackageVersions: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions,
    recommendedAuthoringPackages: PROMPTFRAME_AUTHORING_STANDARD_RELEASE.recommendedAuthoringPackages,
    diagnostic,
    retryable: false,
  };
}

export function computePackageChanges(packageJson: ComponentPackageJson): PackageChange[] {
  const recommendations = PROMPTFRAME_AUTHORING_STANDARD_RELEASE.recommendedAuthoringPackages;
  const requirements: Array<{ name: string; next: string; dependencySet: PackageDependencySet }> = packageFreshnessRules
    .filter((rule) => rule.requiredForMarketplace)
    .map((rule) => ({
      name: rule.name,
      next: `^${recommendations[rule.floorKey]}`,
      dependencySet: rule.defaultDependencySet,
    }));
  if (hasDependency(packageJson, 'create-promptframe-component')) {
    requirements.push({
      name: 'create-promptframe-component',
      next: `^${recommendations.createComponent}`,
      dependencySet: 'devDependencies',
    });
  }
  return requirements.flatMap((requirement) => {
    const current = findDependency(packageJson, requirement.name);
    const dependencySet = current && isWritableDependencySet(current.dependencySet)
      ? current.dependencySet
      : requirement.dependencySet;
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

export function computePackageFreshnessDiagnostics(
  packageJson: ComponentPackageJson,
  target: AuthoringUploadTarget,
): PackageFreshnessDiagnostic[] {
  const floors = PROMPTFRAME_AUTHORING_STANDARD_RELEASE.minPackageVersions;
  const diagnostics: PackageFreshnessDiagnostic[] = [];
  const requiresPublicAuthoringFloors = target === 'marketplace_authoring';

  for (const rule of packageFreshnessRules) {
    const dependency = findDependency(packageJson, rule.name);
    const minimum = floors[rule.floorKey];
    if (!dependency) {
      if (requiresPublicAuthoringFloors && rule.requiredForMarketplace && rule.missingCode) {
        diagnostics.push({
          code: rule.missingCode,
          severity: 'error',
          packageName: rule.name,
          minimum,
          message: `package.json is missing ${rule.name}; ${target} requires ^${minimum} or newer.`,
        });
      }
      continue;
    }
    if (isBelowRequiredRange(dependency.version, minimum)) {
      diagnostics.push({
        code: rule.minVersionCode,
        severity: 'error',
        packageName: rule.name,
        current: dependency.version,
        minimum,
        dependencySet: dependency.dependencySet,
        message: `${rule.name} is stale: current=${dependency.version}, minimum=${minimum}. Run promptframe upgrade . --apply before upload.`,
      });
    }
  }

  return diagnostics;
}

export function computeScaffoldFreshnessDiagnostics(
  metadata: ScaffoldMetadata | undefined,
): ScaffoldFreshnessDiagnostic[] {
  if (!metadata || metadata.createdByPackage !== 'create-promptframe-component') return [];
  const minimum = PROMPTFRAME_AUTHORING_STANDARD_RELEASE.recommendedAuthoringPackages.createComponent;
  const current = typeof metadata.createdByVersion === 'string' ? metadata.createdByVersion : undefined;
  const templateName = typeof metadata.templateName === 'string' ? metadata.templateName : undefined;
  const templateDigest = typeof metadata.templateDigest === 'string' ? metadata.templateDigest : undefined;
  const expectedTemplateDigest = templateName
    ? PROMPTFRAME_AUTHORING_STANDARD_RELEASE.scaffoldTemplates.find((template) => template.name === templateName)?.digest
    : undefined;
  const versionStale = !current || isBelowRequiredRange(current, minimum);
  const digestStale = Boolean(expectedTemplateDigest && templateDigest !== expectedTemplateDigest);
  if (!versionStale && !digestStale) return [];
  const staleReasons = [
    versionStale ? `version current=${current ?? '<unknown>'}, minimum=${minimum}` : null,
    digestStale ? `templateDigest current=${templateDigest ?? '<missing>'}, expected=${expectedTemplateDigest}` : null,
  ].filter(Boolean).join('; ');
  return [{
    code: 'scaffold.template.stale',
    severity: 'warning',
    packageName: 'create-promptframe-component',
    current,
    minimum,
    templateName,
    templateDigest,
    expectedTemplateDigest,
    repairHint: 'Run promptframe upgrade . --check-latest to review local scaffold freshness (package floors and template digest; this does not query npm latest), then regenerate or manually port the latest scaffold shell changes.',
    message: `PromptFrame scaffold template is stale: ${staleReasons}. Review latest scaffold changes before upload.`,
  }];
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
): { dependencySet: keyof Pick<ComponentPackageJson, 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'>; version: string } | undefined {
  for (const dependencySet of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const dependencies = asStringMap(packageJson[dependencySet]);
    const version = dependencies?.[name];
    if (version) return { dependencySet, version };
  }
  return undefined;
}

function isWritableDependencySet(
  value: keyof Pick<ComponentPackageJson, 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'>,
): value is PackageDependencySet {
  return value === 'dependencies' || value === 'devDependencies';
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
