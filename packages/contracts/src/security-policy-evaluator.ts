import ts from 'typescript';
import {
  COMPONENT_SECURITY_POLICY_VERSION,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY,
  PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
} from './index.js';

export { PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST } from './index.js';

export type PromptFrameSecurityPolicyAction = 'reject' | 'manual_review' | 'warn';
export type PromptFrameSecurityPolicyDetectionKind = 'ast' | 'pattern';
export type PromptFrameSecurityPolicyConfidence = 'high' | 'medium' | 'low';

export interface PromptFrameSecurityPolicyFinding {
  ruleId: string;
  policyVersion: string;
  policyDigest: string;
  category: string;
  severity: string;
  action: PromptFrameSecurityPolicyAction;
  message: string;
  file: string;
  line?: number;
  column?: number;
  evidence?: string;
  recommendation?: string;
  detectionKind: PromptFrameSecurityPolicyDetectionKind;
  confidence: PromptFrameSecurityPolicyConfidence;
  trace?: string[];
}

export interface EvaluatePromptFrameSecurityPolicySourceInput {
  file: string;
  source: string;
  policy?: typeof PROMPTFRAME_PUBLIC_SECURITY_POLICY;
  mode?: 'ast' | 'pattern_fallback';
}

export interface PromptFrameSecurityPolicyEvaluationReceipt {
  policyVersion: typeof COMPONENT_SECURITY_POLICY_VERSION;
  policyDigest: typeof PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST;
  evaluatorMode: 'ast' | 'pattern_fallback';
  findings: PromptFrameSecurityPolicyFinding[];
}

interface AstMatchers {
  globals?: readonly string[];
  memberPaths?: readonly string[];
  dynamicImport?: boolean;
  stringTimer?: boolean;
}

interface PublicSecurityRule {
  id: string;
  label: string;
  category?: string;
  severity?: string;
  reason: string;
  recommendation?: string;
  action?: PromptFrameSecurityPolicyAction;
  defaultAction?: PromptFrameSecurityPolicyAction;
  patterns?: readonly string[];
  rawApis?: readonly string[];
  astMatchers?: AstMatchers;
}

export function evaluatePromptFrameSecurityPolicySource(
  input: EvaluatePromptFrameSecurityPolicySourceInput,
): PromptFrameSecurityPolicyEvaluationReceipt {
  const policy = input.policy ?? PROMPTFRAME_PUBLIC_SECURITY_POLICY;
  const evaluatorMode = input.mode ?? (isAstScannableSourceFile(input.file) ? 'ast' : 'pattern_fallback');
  const findings = evaluatorMode === 'ast'
    ? evaluateAstSource(input.file, input.source, collectPublicSecurityRules(policy))
    : evaluatePatternSource(input.file, input.source, collectPublicSecurityRules(policy));

  return {
    policyVersion: COMPONENT_SECURITY_POLICY_VERSION,
    policyDigest: PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    evaluatorMode,
    findings: dedupeFindings(findings),
  };
}

function evaluateAstSource(
  file: string,
  source: string,
  rules: PublicSecurityRule[],
): PromptFrameSecurityPolicyFinding[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
  const localDeclarations = new Set<string>();
  const aliases = new Map<string, string>();
  const findings: PromptFrameSecurityPolicyFinding[] = [];

  collectLocalDeclarations(sourceFile, localDeclarations);
  collectAliases(sourceFile, localDeclarations, aliases);

  const visit = (node: ts.Node): void => {
    for (const rule of rules) {
      const match = matchAstRule(rule, node, sourceFile, localDeclarations, aliases);
      if (!match) continue;
      findings.push(buildFinding({
        file,
        sourceFile,
        node: match.node,
        rule,
        evidence: match.node.getText(sourceFile).slice(0, 160),
        detectionKind: 'ast',
        confidence: match.confidence,
        trace: match.trace,
      }));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function evaluatePatternSource(
  file: string,
  source: string,
  rules: PublicSecurityRule[],
): PromptFrameSecurityPolicyFinding[] {
  const findings: PromptFrameSecurityPolicyFinding[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.Unknown);
  for (const rule of rules) {
    const patterns = rule.patterns ?? rule.rawApis?.map(apiToPattern) ?? [];
    for (const patternSource of patterns) {
      const pattern = new RegExp(patternSource, 'i');
      const match = source.match(pattern);
      if (!match || match.index === undefined) continue;
      findings.push(buildFinding({
        file,
        sourceFile,
        position: match.index,
        rule,
        evidence: match[0].slice(0, 160),
        detectionKind: 'pattern',
        confidence: 'medium',
        trace: [`pattern:${patternSource}`],
      }));
    }
  }
  return findings;
}

function matchAstRule(
  rule: PublicSecurityRule,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  localDeclarations: Set<string>,
  aliases: Map<string, string>,
): { node: ts.Node; confidence: PromptFrameSecurityPolicyConfidence; trace: string[] } | undefined {
  const matcher = rule.astMatchers;
  if (!matcher) return undefined;

  if (matcher.dynamicImport && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return { node, confidence: 'high', trace: ['dynamicImport'] };
  }

  if (matcher.stringTimer && ts.isCallExpression(node)) {
    const name = expressionName(node.expression, sourceFile);
    if ((name === 'setTimeout' || name === 'setInterval') && isStringLikeExpression(node.arguments[0])) {
      return { node, confidence: 'high', trace: [`stringTimer:${name}`] };
    }
  }

  const globals = new Set(matcher.globals ?? []);
  if (globals.size > 0 && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
    const name = expressionName(node.expression, sourceFile);
    const resolved = name ? aliases.get(name) ?? name : undefined;
    if (resolved && globals.has(resolved) && !localDeclarations.has(resolved)) {
      return { node, confidence: 'high', trace: [`global:${resolved}`] };
    }
  }

  const memberPaths = matcher.memberPaths ?? [];
  if (memberPaths.length > 0 && (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
    const expression = ts.isCallExpression(node) || ts.isNewExpression(node) ? node.expression : node;
    const path = memberPath(expression, sourceFile);
    const matchedPath = memberPaths.find((candidate) => path === candidate || path.startsWith(`${candidate}.`));
    if (matchedPath) return { node, confidence: 'high', trace: [`member:${matchedPath}`] };
  }

  return undefined;
}

function collectLocalDeclarations(sourceFile: ts.SourceFile, localDeclarations: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isParameter(node))
      && node.name
    ) {
      collectBindingNames(node.name, localDeclarations);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectAliases(
  sourceFile: ts.SourceFile,
  localDeclarations: Set<string>,
  aliases: Map<string, string>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializerName = expressionName(node.initializer, sourceFile);
      if (initializerName && !localDeclarations.has(initializerName)) aliases.set(node.name.text, initializerName);
      const initializerPath = memberPath(node.initializer, sourceFile);
      if ((initializerPath === 'globalThis' || initializerPath === 'window') && ts.isObjectBindingPattern(node.name)) {
        collectDestructureAliases(node.name, aliases);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const initializerPath = memberPath(node.initializer, sourceFile);
      if (initializerPath === 'globalThis' || initializerPath === 'window') {
        collectDestructureAliases(node.name, aliases);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectDestructureAliases(binding: ts.ObjectBindingPattern, aliases: Map<string, string>): void {
  for (const element of binding.elements) {
    const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
      ? element.propertyName.text
      : ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
    if (!propertyName || !ts.isIdentifier(element.name)) continue;
    aliases.set(element.name.text, propertyName);
  }
}

function collectBindingNames(name: ts.BindingName, output: Set<string>): void {
  if (ts.isIdentifier(name)) {
    output.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, output);
  }
}

function expressionName(expression: ts.Expression, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  const path = memberPath(expression, sourceFile);
  return path.includes('.') ? undefined : path || undefined;
}

function memberPath(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(node)) return node.text;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (ts.isPropertyAccessExpression(node)) {
    const parent = memberPath(node.expression, sourceFile);
    return parent ? `${parent}.${node.name.text}` : node.name.text;
  }
  if (ts.isElementAccessExpression(node)) {
    const parent = memberPath(node.expression, sourceFile);
    const key = stringLiteralValue(node.argumentExpression);
    return parent && key ? `${parent}.${key}` : '';
  }
  return '';
}

function stringLiteralValue(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function isStringLikeExpression(node: ts.Expression | undefined): boolean {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

function buildFinding(input: {
  file: string;
  sourceFile: ts.SourceFile;
  node?: ts.Node;
  position?: number;
  rule: PublicSecurityRule;
  evidence: string;
  detectionKind: PromptFrameSecurityPolicyDetectionKind;
  confidence: PromptFrameSecurityPolicyConfidence;
  trace: string[];
}): PromptFrameSecurityPolicyFinding {
  const position = input.position ?? input.node?.getStart(input.sourceFile) ?? 0;
  const location = input.sourceFile.getLineAndCharacterOfPosition(position);
  return {
    ruleId: input.rule.id,
    policyVersion: COMPONENT_SECURITY_POLICY_VERSION,
    policyDigest: PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST,
    category: input.rule.category ?? 'dynamic_code_execution',
    severity: input.rule.severity ?? 'high',
    action: input.rule.action ?? input.rule.defaultAction ?? 'manual_review',
    message: `${input.rule.label}: ${input.rule.reason}`,
    file: input.file,
    line: location.line + 1,
    column: location.character + 1,
    evidence: input.evidence,
    recommendation: input.rule.recommendation,
    detectionKind: input.detectionKind,
    confidence: input.confidence,
    trace: input.trace,
  };
}

function collectPublicSecurityRules(policy: typeof PROMPTFRAME_PUBLIC_SECURITY_POLICY): PublicSecurityRule[] {
  return [
    ...(policy.forbiddenApis as readonly PublicSecurityRule[]),
    ...(policy.mediatedApis as readonly PublicSecurityRule[]),
    ...(policy.warningApis as readonly PublicSecurityRule[]),
  ];
}

function dedupeFindings(findings: PromptFrameSecurityPolicyFinding[]): PromptFrameSecurityPolicyFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.ruleId}:${finding.file}:${finding.line ?? ''}:${finding.column ?? ''}:${finding.evidence ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isAstScannableSourceFile(file: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs)$/i.test(file);
}

function scriptKindForFile(file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.ts$/i.test(file) || /\.mts$/i.test(file) || /\.cts$/i.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(file) || /\.mjs$/i.test(file) || /\.cjs$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.Unknown;
}

function apiToPattern(api: string): string {
  const escaped = api.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (api === 'fetch') return '\\bfetch\\s*\\(';
  if (api === 'XMLHttpRequest') return '\\bnew\\s+XMLHttpRequest\\b|\\bXMLHttpRequest\\s*\\(';
  if (api === 'WebSocket') return '\\bnew\\s+WebSocket\\b|\\bWebSocket\\s*\\(';
  if (api === 'EventSource') return '\\bnew\\s+EventSource\\b|\\bEventSource\\s*\\(';
  if (api === 'navigator.sendBeacon') return 'navigator\\.sendBeacon\\s*\\(';
  return api.includes('.')
    ? `${escaped}\\s*\\(`
    : `\\b${escaped}\\b`;
}
