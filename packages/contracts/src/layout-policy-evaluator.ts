import ts from 'typescript';
import {
  evaluatePromptFrameLayoutPolicy as evaluatePatternLayoutPolicy,
  type ComponentDiagnostic,
  type PromptFrameLayoutPolicyFile,
  type PromptFrameLayoutPolicyInput,
  type PromptFrameLayoutPolicyReport,
} from './index.js';

const layoutProperties = new Set([
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'padding', 'paddingInline', 'paddingBlock', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginInline', 'marginBlock', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap', 'fontSize', 'lineHeight', 'inset', 'top', 'right', 'bottom', 'left',
]);
const replacedRules = new Set([
  'component.layout.root_fixed_size', 'component.layout.root_viewport_unit', 'component.layout.naked_px_high_risk',
]);
const supportFile = (name: string) => /(?:^|\/)PreviewRoot\.[jt]sx?$|\.(?:test|spec)\.[jt]sx?$|(?:^|\/)vite-env\.d\.ts$/i.test(name);
const normalize = (name: string, importer = '/') => {
  const input = name.replace(/\\/g, '/');
  const absolute = input.startsWith('/') ? input : importer.slice(0, importer.lastIndexOf('/') + 1) + input;
  const parts: string[] = [];
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return '/' + parts.join('/');
};
const noComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '));

/** Node authoring analysis stays in this subpath, so browser/runtime helpers
 * do not import the TypeScript compiler. No filesystem or network is read. */
export function evaluatePromptFrameLayoutPolicy(input: PromptFrameLayoutPolicyInput): PromptFrameLayoutPolicyReport {
  const manifest = input.manifest as { entry?: { sourcePath?: unknown } } | undefined;
  const primaryPath = input.componentSourcePath
    ?? (typeof manifest?.entry?.sourcePath === 'string' ? manifest.entry.sourcePath : 'src/Component.tsx');
  const files: PromptFrameLayoutPolicyFile[] = [
    ...(input.componentSourceText === undefined ? [] : [{ path: primaryPath, sourceText: input.componentSourceText }]),
    ...(input.styleSourceText === undefined ? [] : [{ path: 'src/Component.module.css', sourceText: input.styleSourceText }]),
    ...(input.files ?? []),
  ];
  const base = evaluatePatternLayoutPolicy({ ...input, componentSourcePath: primaryPath,
    ...(input.styleSourceText === undefined ? {} : { styleSourceText: noComments(input.styleSourceText) }),
    files: input.files?.map(file => /\.css$/i.test(file.path) ? { ...file, sourceText: noComments(file.sourceText) } : file),
  });
  const diagnostics = base.diagnostics.filter(row => !replacedRules.has(row.code));
  const reported = new Set<string>();
  const add = (code: string, file: string, text: string, offset: number, property: string) => {
    const key = code + ':' + file;
    if (reported.has(key)) return;
    reported.add(key);
    const before = text.slice(0, offset), line = before.split(/\r?\n/).length;
    const column = offset - Math.max(before.lastIndexOf('\n'), -1);
    diagnostics.push({ code, severity: 'error', stage: 'authoring',
      message: `${file}:${line}:${column}: ${property}.`,
      repairHint: code === 'component.layout.source_parse_unresolved' ? 'Fix the source syntax before checking layout.'
        : 'Use parent-slot-relative sizing or component-kit layout.px()/layout.clamp() for design-space lengths.',
    });
  };
  const checkValue = (property: string, value: string | number, file: PromptFrameLayoutPolicyFile, offset: number) => {
    if (!layoutProperties.has(property)) return;
    if (typeof value === 'string' && /\b100v[wh]\b/i.test(value)) {
      add('component.layout.root_viewport_unit', file.path, file.sourceText, offset, property + ' escapes the parent slot');
    }
    const numeric = typeof value === 'number' ? value : /^-?\d+(?:\.\d+)?(?:px)?$/.test(value.trim()) ? Number.parseFloat(value) : undefined;
    const pixels = typeof value === 'string' && [...value.matchAll(/(?:^|[^\w.])(-?(?:\d*\.)?\d+)px\b/gi)]
      .some(match => Number(match[1]) !== 0);
    if (pixels || numeric !== undefined && numeric !== 0 && property !== 'lineHeight') {
      add('component.layout.naked_px_high_risk', file.path, file.sourceText, offset, property + ' contains an unscaled pixel length');
    }
  };
  for (const file of files.filter(file => /\.css$/i.test(file.path) && !supportFile(file.path))) {
    const text = noComments(file.sourceText);
    for (const match of text.matchAll(/(?:^|[;{\n])\s*([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const property = match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      checkValue(property, match[2]!, file, match.index! + match[0].indexOf(match[1]!));
    }
  }
  const sources = new Map<string, PromptFrameLayoutPolicyFile>();
  for (const file of files.filter(file => /\.[cm]?[jt]sx?$/i.test(file.path))) {
    const name = normalize(file.path), previous = sources.get(name);
    if (previous && previous.sourceText !== file.sourceText) {
      add('component.layout.source_parse_unresolved', file.path, file.sourceText, 0, 'conflicting source bytes for one path');
    } else sources.set(name, file);
  }
  if (input.componentSourceText !== undefined && !sources.has(normalize(primaryPath))) {
    add('component.layout.source_parse_unresolved', primaryPath, input.componentSourceText, 0, 'component source format is unresolved');
  }
  const sourceFiles = new Map([...sources].map(([name, file]) => [name,
    ts.createSourceFile(name, file.sourceText, ts.ScriptTarget.Latest, true,
      /x$/i.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)]));
  const resolveVirtual = (name: string, importer: string): ts.ResolvedModule | undefined => {
    if (!name.startsWith('.')) return undefined;
    const base = normalize(name, importer), stem = base.replace(/\.[cm]?jsx?$/, '');
    for (const candidate of [base, stem + '.ts', stem + '.tsx', base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx']) {
      if (sourceFiles.has(candidate)) return { resolvedFileName: candidate, isExternalLibraryImport: false };
    }
    return undefined;
  };
  const host: ts.CompilerHost = {
    getSourceFile: name => sourceFiles.get(normalize(name)),
    getDefaultLibFileName: () => '/__no_lib__.d.ts', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: name => sourceFiles.has(normalize(name)),
    readFile: name => sources.get(normalize(name))?.sourceText,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, importer) => names.map(name => resolveVirtual(name, importer)),
  };
  const program = ts.createProgram([...sourceFiles.keys()], { noLib: true, noResolve: false,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve }, host);
  const checker = program.getTypeChecker();
  const runtimeFiles = new Set<string>(), pendingFiles = [normalize(primaryPath)];
  while (pendingFiles.length) {
    const name = pendingFiles.pop()!, source = sourceFiles.get(name);
    if (!source || runtimeFiles.has(name)) continue;
    runtimeFiles.add(name);
    for (const imported of ts.preProcessFile(source.text, true, true).importedFiles) {
      const resolved = resolveVirtual(imported.fileName, name);
      if (resolved) pendingFiles.push(resolved.resolvedFileName);
    }
  }
  const unwrap = (node: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
    return node;
  };
  const declarations = (node: ts.Node): readonly ts.Declaration[] => {
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
    if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)) {
      symbol = checker.getShorthandAssignmentValueSymbol(node.parent) ?? symbol;
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations ?? [];
  };
  const literalValues = (expression: ts.Expression, seen = new Set<ts.Node>()): Array<string | number> => {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 64) return [];
    const next = new Set(seen).add(node);
    if (ts.isNumericLiteral(node)) return [Number(node.text)];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)) {
      return literalValues(node.operand, next).filter((value): value is number => typeof value === 'number')
        .map(value => node.operator === ts.SyntaxKind.MinusToken ? -value : value);
    }
    if (ts.isConditionalExpression(node)) return [...literalValues(node.whenTrue, next), ...literalValues(node.whenFalse, next)];
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return declarations(node).flatMap(declaration =>
      (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer
        ? literalValues(declaration.initializer, next) : []);
    return [];
  };
  type StyleProperty = { name: string; value: ts.Expression; node: ts.Node };
  const propertyName = (name: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    if (ts.isComputedPropertyName(name)) {
      const values = literalValues(name.expression);
      if (values.length === 1 && typeof values[0] === 'string') return values[0];
    }
    return undefined;
  };
  const properties = (expression: ts.Expression, seen = new Set<ts.Node>()): StyleProperty[][] => {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 64) return [[]];
    const next = new Set(seen).add(node);
    if (ts.isObjectLiteralExpression(node)) {
      let variants: StyleProperty[][] = [[]];
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = properties(property.expression, next);
          if (variants.length * spread.length > 64) {
            const file = sources.get(node.getSourceFile().fileName)!;
            add('component.layout.source_parse_unresolved', file.path, file.sourceText, node.getStart(), 'too many static style branches');
            continue;
          }
          variants = variants.flatMap(rows => spread.map(extra => [...rows, ...extra]));
        } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = propertyName(property.name);
          if (name) for (const rows of variants) rows.push({ name,
            value: ts.isPropertyAssignment(property) ? property.initializer : property.name, node: property });
        }
      }
      return variants;
    }
    if (ts.isConditionalExpression(node)) return [...properties(node.whenTrue, next), ...properties(node.whenFalse, next)];
    if (ts.isCallExpression(node)) {
      const returns = declarations(node.expression).flatMap(declaration => {
        const fn = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
        if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !fn.body) return [];
        if (!ts.isBlock(fn.body)) return properties(fn.body, next);
        const result: StyleProperty[][] = [];
        const visit = (child: ts.Node) => {
          if (ts.isFunctionLike(child)) return;
          if (ts.isReturnStatement(child) && child.expression) result.push(...properties(child.expression, next));
          else ts.forEachChild(child, visit);
        };
        ts.forEachChild(fn.body, visit);
        return result;
      });
      return returns.length ? returns : node.arguments.length ? node.arguments.flatMap(argument => properties(argument, next)) : [[]];
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const result = declarations(node).flatMap(declaration => {
        if ((ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
          return properties(declaration.initializer, next);
        }
        if (ts.isExportAssignment(declaration)) return properties(declaration.expression, next);
        return [];
      });
      return result.length ? result : [[]];
    }
    return [[]];
  };
  const checkStyle = (expression: ts.Expression) => {
    for (const variant of properties(expression)) {
      const rows = new Map(variant.map(row => [row.name, row]));
      const fixed = new Set<string>();
      for (const { name, value, node } of rows.values()) {
        const sf = node.getSourceFile(), file = sources.get(sf.fileName)!;
        for (const literal of literalValues(value)) {
          checkValue(name, literal, file, node.getStart(sf));
          if ((name === 'width' || name === 'height') && (typeof literal === 'number' ? literal !== 0 : /^-?\d+(?:\.\d+)?(?:px)?$/.test(literal) && Number.parseFloat(literal) !== 0)) fixed.add(name);
        }
      }
      if (fixed.has('width') && fixed.has('height')) {
        const sf = expression.getSourceFile(), file = sources.get(sf.fileName)!;
        add('component.layout.root_fixed_size', file.path, file.sourceText, expression.getStart(sf), 'style defines fixed final width/height');
      }
    }
  };
  const checkProps = (variants: StyleProperty[][]) => {
    for (const variant of variants) {
      const style = new Map(variant.map(row => [row.name, row])).get('style');
      if (style) checkStyle(style.value);
    }
  };
  for (const [name, sf] of sourceFiles) {
    if (supportFile(name) && !runtimeFiles.has(name)) continue;
    for (const diagnostic of program.getSyntacticDiagnostics(sf)) {
      const file = sources.get(name)!;
      add('component.layout.source_parse_unresolved', file.path, file.sourceText, diagnostic.start ?? 0, 'source syntax is unresolved');
    }
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        let variants: StyleProperty[][] = [[]];
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) {
            const spread = properties(attribute.expression);
            if (variants.length * spread.length > 64) {
              const file = sources.get(name)!;
              add('component.layout.source_parse_unresolved', file.path, file.sourceText,
                attribute.getStart(sf), 'too many static JSX props branches');
              continue;
            }
            variants = variants.flatMap(rows => spread.map(extra => [...rows, ...extra]));
          } else if (attribute.name.getText(sf) === 'style' && attribute.initializer
            && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
            for (const rows of variants) rows.push({ name: 'style', value: attribute.initializer.expression, node: attribute });
          }
        }
        checkProps(variants);
      }
      if (ts.isVariableDeclaration(node) && node.type && /\bCSSProperties\b/.test(node.type.getText(sf)) && node.initializer) checkStyle(node.initializer);
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let callName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        if (ts.isIdentifier(callee)) {
          const declaration = checker.getSymbolAtLocation(callee)?.declarations?.[0];
          if (declaration && ts.isImportSpecifier(declaration)) callName = declaration.propertyName?.text ?? declaration.name.text;
        }
        if (['createElement', 'jsx', 'jsxs'].includes(callName) && node.arguments[1]) {
          checkProps(properties(node.arguments[1]));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const priority = (code: string) => {
    const index = (base.checkedRuleIds as readonly string[]).indexOf(code);
    return index < 0 ? base.checkedRuleIds.length : index;
  };
  diagnostics.sort((a, b) => priority(a.code) - priority(b.code));
  return { ...base, diagnostics: diagnostics as ComponentDiagnostic[], accepted: !diagnostics.some(row => row.severity === 'error') };
}
