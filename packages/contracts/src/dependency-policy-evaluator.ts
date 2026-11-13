import ts from 'typescript';
import {
  evaluatePromptFrameDependencyPolicy as evaluateDeclaredPolicy,
  type ComponentDiagnostic,
  type EvaluatePromptFrameDependencyPolicyInput,
  type PromptFrameDependencyPolicyReceipt,
  type PromptFrameLayoutPolicyFile,
} from './index.js';

export interface RuntimeDependencyPolicyInput extends EvaluatePromptFrameDependencyPolicyInput {
  runtimeEntryPaths: readonly string[];
  files: readonly PromptFrameLayoutPolicyFile[];
}

/** Analyze supplied immutable source bytes only. This does not install packages,
 * execute components, or replace the frozen-lockfile sandbox supply-chain check. */
export function evaluatePromptFrameDependencyPolicy(input: RuntimeDependencyPolicyInput): PromptFrameDependencyPolicyReceipt {
  const packageJson = record(input.packageJson), runtime = { ...packageJson };
  delete runtime.devDependencies;
  const report = evaluateDeclaredPolicy({ ...input, packageJson: runtime });
  const diagnostics: ComponentDiagnostic[] = [];
  const add = (code: string, message: string) => diagnostics.push({ code, message, severity: 'error', stage: 'package',
    repairHint: 'Keep runtime imports inside the package and declare their packages in dependencies, peerDependencies or optionalDependencies; retain a frozen lockfile.' });
  const normalize = (value: string): string | undefined => {
    if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return undefined;
    const parts: string[] = [];
    for (const part of value.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
      else parts.push(part);
    }
    return parts.join('/');
  };
  const files = new Map<string, string>();
  for (const file of input.files) {
    const name = normalize(file.path);
    if (!name || files.has(name) && files.get(name) !== file.sourceText) {
      add('dependency.runtime.source_unresolved', 'Runtime source paths must have one package-local byte snapshot.');
    } else files.set(name, file.sourceText);
  }
  const resolveSource = (request: string, importer = '') => {
    const [path, query] = request.split('?');
    const base = normalize((importer ? importer.slice(0, importer.lastIndexOf('/') + 1) : '') + path!);
    if (!base || query !== undefined && query !== 'raw') return undefined;
    const stem = base.replace(/\.[cm]?jsx?$/, '');
    const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'].map(ext => stem + ext),
      ...['ts', 'tsx', 'js', 'jsx'].map(ext => base + '/index.' + ext)];
    const name = candidates.find(name => files.has(name));
    return name ? { name, raw: query === 'raw' } : undefined;
  };
  const declared = new Set(['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(field => Object.keys(record(packageJson[field]))));
  const dev = record(packageJson.devDependencies), visited = new Set<string>();
  const pending = input.runtimeEntryPaths.map(request => ({ request, importer: '' }));
  if (!pending.length) add('dependency.runtime.source_unresolved', 'Runtime entry paths are required.');
  while (pending.length) {
    const { request, importer } = pending.pop()!;
    const resolved = resolveSource(request, importer);
    if (!resolved) { add('dependency.runtime.source_unresolved', `${importer || 'entry'} cannot resolve runtime source ${request}.`); continue; }
    if (resolved.raw || visited.has(resolved.name)) continue;
    visited.add(resolved.name);
    if (!/\.[cm]?[jt]sx?$/i.test(resolved.name)) continue;
    const sf = ts.createSourceFile(resolved.name, files.get(resolved.name)!, ts.ScriptTarget.Latest, true);
    if ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
      add('dependency.runtime.source_unresolved', `${resolved.name} has unresolved source syntax.`);
    }
    const use = (specifier: string) => {
      if (specifier.startsWith('./') || specifier.startsWith('../')) { pending.push({ request: specifier, importer: resolved.name }); return; }
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
      if (!declared.has(name)) add(Object.hasOwn(dev, name) ? 'dependency.runtime.dev_only_import' : 'dependency.runtime.undeclared_import',
        `${resolved.name} imports ${specifier}, which is ${Object.hasOwn(dev, name) ? 'only in devDependencies' : 'not a declared runtime dependency'}.`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause && (clause.isTypeOnly || !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly))) return;
        if (ts.isStringLiteralLike(node.moduleSpecifier)) use(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node)) {
        if (node.isTypeOnly || node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0
          && node.exportClause.elements.every(element => element.isTypeOnly)) return;
        if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) use(node.moduleSpecifier.text);
      } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        if (node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) use(node.moduleReference.expression.text);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) use(node.arguments[0].text);
        else add('dependency.runtime.import_unresolved', `${resolved.name} has a non-static runtime module reference.`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return diagnostics.length ? { ...report, status: 'reject', publicSearchableAllowed: false, quarantine: false,
    diagnostics: [...report.diagnostics, ...diagnostics] } : report;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
