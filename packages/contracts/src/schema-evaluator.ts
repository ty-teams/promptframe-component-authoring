import ts from 'typescript';

export const PROMPTFRAME_SCHEMA_EVALUATOR_VERSION = 'promptframe-schema-evaluator/v1' as const;

export type PromptFrameStaticSchemaType =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

export interface PromptFrameStaticSchemaNode {
  type?: PromptFrameStaticSchemaType;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  items?: PromptFrameStaticSchemaNode;
  properties?: Record<string, PromptFrameStaticSchemaNode>;
  required?: string[];
  additionalProperties?: boolean | PromptFrameStaticSchemaNode;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

export type PromptFrameSchemaDiagnosticCode =
  | 'schema.props_schema_not_static'
  | 'schema.reference_cycle'
  | 'schema.reference_unresolved'
  | 'schema.wrapper_unresolved';

export interface PromptFrameSchemaDiagnostic {
  code: PromptFrameSchemaDiagnosticCode;
  message: string;
  propPath?: string;
  wrapperName?: string;
  line: number;
  column: number;
}

export interface PromptFrameSchemaFacts {
  evaluatorVersion: typeof PROMPTFRAME_SCHEMA_EVALUATOR_VERSION;
  status: 'resolved' | 'partial' | 'schema_not_static';
  propKeys: string[];
  requiredPropKeys: string[];
  properties: Record<string, PromptFrameStaticSchemaNode>;
  diagnostics: PromptFrameSchemaDiagnostic[];
}

interface ParseContext {
  sourceFile: ts.SourceFile;
  variables: Map<string, ts.Expression>;
  functions: Map<string, ts.FunctionDeclaration>;
  imports: Map<string, { imported: string; source: string }>;
  resolving: Set<string>;
}

interface ResolvedSchema {
  schema: PromptFrameStaticSchemaNode;
  required: boolean;
  diagnostics: PromptFrameSchemaDiagnostic[];
}

const TRUSTED_IDENTITY_WRAPPERS = new Map<string, Set<string>>([
  ['@promptframe/component-kit/schema', new Set([
    'promptFrameResourceSlot',
    'withPromptFrameResourceSlot',
  ])],
]);

const ALLOWED_TRANSPARENT_METADATA_PATHS = new Set([
  '_def.promptFrameResource',
  '_def.xPromptFrameResource',
]);

export function evaluatePromptFrameSchemaSource(source: string): PromptFrameSchemaFacts {
  const sourceFile = ts.createSourceFile('schema.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const context: ParseContext = {
    sourceFile,
    variables: new Map(),
    functions: new Map(),
    imports: new Map(),
    resolving: new Set(),
  };
  collectTopLevelDeclarations(sourceFile, context);

  const propsSchema = context.variables.get('propsSchema');
  if (!propsSchema) {
    const diagnostic = diagnosticAt(
      context,
      sourceFile,
      'schema.props_schema_not_static',
      'A static top-level propsSchema declaration was not found.',
    );
    return emptyFacts('schema_not_static', [diagnostic]);
  }

  const resolved = resolveSchemaExpression(propsSchema, context);
  if (!resolved.schema.properties) {
    const diagnostic = diagnosticAt(
      context,
      propsSchema,
      'schema.props_schema_not_static',
      'propsSchema must resolve to a static z.object({...}) expression.',
    );
    return emptyFacts('schema_not_static', [...resolved.diagnostics, diagnostic]);
  }

  const propKeys = Object.keys(resolved.schema.properties);
  return {
    evaluatorVersion: PROMPTFRAME_SCHEMA_EVALUATOR_VERSION,
    status: resolved.diagnostics.length > 0 ? 'partial' : 'resolved',
    propKeys,
    requiredPropKeys: resolved.schema.required ?? [],
    properties: resolved.schema.properties,
    diagnostics: resolved.diagnostics,
  };
}

function emptyFacts(
  status: PromptFrameSchemaFacts['status'],
  diagnostics: PromptFrameSchemaDiagnostic[],
): PromptFrameSchemaFacts {
  return {
    evaluatorVersion: PROMPTFRAME_SCHEMA_EVALUATOR_VERSION,
    status,
    propKeys: [],
    requiredPropKeys: [],
    properties: {},
    diagnostics,
  };
}

function collectTopLevelDeclarations(sourceFile: ts.SourceFile, context: ParseContext): void {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          context.variables.set(declaration.name.text, declaration.initializer);
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      context.functions.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const source = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) context.imports.set(clause.name.text, { imported: 'default', source });
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      context.imports.set(element.name.text, {
        imported: element.propertyName?.text ?? element.name.text,
        source,
      });
    }
  }
}

function resolveSchemaExpression(expression: ts.Expression, context: ParseContext): ResolvedSchema {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return resolveSchemaIdentifier(current, context);
  if (!ts.isCallExpression(current)) return unresolvedReference(current, context);

  if (ts.isIdentifier(current.expression)) {
    return resolveWrapperCall(current, current.expression, context);
  }
  if (!ts.isPropertyAccessExpression(current.expression)) return unresolvedReference(current, context);

  const method = current.expression.name.text;
  const receiver = unwrapExpression(current.expression.expression);
  if (ts.isIdentifier(receiver) && receiver.text === 'z') {
    return resolveZodFactory(method, current.arguments, current, context);
  }

  const base = resolveSchemaExpression(receiver, context);
  return applyZodMethod(base, method, current.arguments);
}

function resolveSchemaIdentifier(identifier: ts.Identifier, context: ParseContext): ResolvedSchema {
  const name = identifier.text;
  const initializer = context.variables.get(name);
  if (!initializer) return unresolvedReference(identifier, context, name);
  if (context.resolving.has(name)) {
    return {
      schema: {},
      required: true,
      diagnostics: [diagnosticAt(
        context,
        identifier,
        'schema.reference_cycle',
        `Schema reference cycle detected at ${name}.`,
      )],
    };
  }
  context.resolving.add(name);
  const resolved = resolveSchemaExpression(initializer, context);
  context.resolving.delete(name);
  return resolved;
}

function resolveWrapperCall(
  call: ts.CallExpression,
  callee: ts.Identifier,
  context: ParseContext,
): ResolvedSchema {
  const firstArg = call.arguments[0];
  if (!firstArg) return unresolvedWrapper(call, callee.text, context);
  const imported = context.imports.get(callee.text);
  const trustedImport = imported
    && TRUSTED_IDENTITY_WRAPPERS.get(imported.source)?.has(imported.imported);
  const localFunction = context.functions.get(callee.text);
  if (!trustedImport && (!localFunction || !isProvenTransparentSchemaWrapper(localFunction))) {
    return unresolvedWrapper(call, callee.text, context);
  }
  return resolveSchemaExpression(firstArg, context);
}

function resolveZodFactory(
  method: string,
  args: ts.NodeArray<ts.Expression>,
  node: ts.Node,
  context: ParseContext,
): ResolvedSchema {
  if (method === 'string') return resolved({ type: 'string' });
  if (method === 'number') return resolved({ type: 'number' });
  if (method === 'boolean') return resolved({ type: 'boolean' });
  if (method === 'array') {
    const item = args[0] ? resolveSchemaExpression(args[0], context) : resolved({});
    return resolved({ type: 'array', items: item.schema }, true, item.diagnostics);
  }
  if (method === 'object' && args[0] && ts.isObjectLiteralExpression(unwrapExpression(args[0]))) {
    return resolveObjectLiteral(unwrapExpression(args[0]) as ts.ObjectLiteralExpression, context);
  }
  if (method === 'enum' && args[0] && ts.isArrayLiteralExpression(unwrapExpression(args[0]))) {
    const values = (unwrapExpression(args[0]) as ts.ArrayLiteralExpression).elements
      .map(readLiteralValue)
      .filter((value) => value !== undefined);
    return resolved({
      type: values.every((value) => typeof value === 'number') ? 'number' : 'string',
      enum: values,
    });
  }
  if (method === 'literal' && args[0]) {
    const value = readLiteralValue(args[0]);
    return resolved({ ...schemaTypeForLiteral(value), const: value });
  }
  if (method === 'record') {
    const value = args[0] ? resolveSchemaExpression(args[0], context) : resolved({});
    return resolved({ type: 'object', additionalProperties: value.schema }, true, value.diagnostics);
  }
  return {
    schema: {},
    required: true,
    diagnostics: [diagnosticAt(
      context,
      node,
      'schema.reference_unresolved',
      `Unsupported static Zod factory z.${method}().`,
    )],
  };
}

function resolveObjectLiteral(object: ts.ObjectLiteralExpression, context: ParseContext): ResolvedSchema {
  const properties: Record<string, PromptFrameStaticSchemaNode> = {};
  const required: string[] = [];
  const diagnostics: PromptFrameSchemaDiagnostic[] = [];

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      diagnostics.push(diagnosticAt(
        context,
        property,
        'schema.reference_unresolved',
        'Only static property assignments are supported in propsSchema.',
      ));
      continue;
    }
    const key = readPropertyName(property.name);
    if (!key) {
      diagnostics.push(diagnosticAt(
        context,
        property.name,
        'schema.reference_unresolved',
        'Computed propsSchema property names are not supported.',
      ));
      continue;
    }
    const value = resolveSchemaExpression(property.initializer, context);
    properties[key] = value.schema;
    if (value.required) required.push(key);
    diagnostics.push(...value.diagnostics.map((item) => ({
      ...item,
      propPath: item.propPath ? `${key}.${item.propPath}` : key,
    })));
  }

  return resolved({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }, true, diagnostics);
}

function applyZodMethod(
  base: ResolvedSchema,
  method: string,
  args: ts.NodeArray<ts.Expression>,
): ResolvedSchema {
  const schema = { ...base.schema };
  const numericArg = args[0] ? readNumericLiteral(args[0]) : null;
  let required = base.required;
  if (method === 'default' || method === 'optional' || method === 'nullish') {
    required = false;
  }
  if (method === 'default' && args[0]) schema.default = readJsonLiteralValue(args[0]);
  if (method === 'describe' && args[0] && ts.isStringLiteralLike(unwrapExpression(args[0]))) {
    schema.description = (unwrapExpression(args[0]) as ts.StringLiteralLike).text;
  }
  if (method === 'int' && schema.type === 'number') schema.type = 'integer';
  if ((method === 'max' || method === 'lte') && numericArg !== null) {
    if (schema.type === 'string') schema.maxLength = Math.floor(numericArg);
    else if (schema.type === 'array') schema.maxItems = Math.floor(numericArg);
    else schema.maximum = numericArg;
  }
  if ((method === 'min' || method === 'gte') && numericArg !== null) {
    if (schema.type === 'string') schema.minLength = Math.floor(numericArg);
    else if (schema.type === 'array') schema.minItems = Math.floor(numericArg);
    else schema.minimum = numericArg;
  }
  if (method === 'length' && numericArg !== null) {
    if (schema.type === 'string') schema.minLength = schema.maxLength = Math.floor(numericArg);
    if (schema.type === 'array') schema.minItems = schema.maxItems = Math.floor(numericArg);
  }
  if (method === 'url') schema.format = 'uri';
  return { schema, required, diagnostics: base.diagnostics };
}

function isProvenTransparentSchemaWrapper(fn: ts.FunctionDeclaration): boolean {
  if (!fn.body || fn.parameters.length === 0 || !ts.isIdentifier(fn.parameters[0].name)) return false;
  const parameter = fn.parameters[0].name.text;
  const aliases = new Map<string, string>([[parameter, '']]);
  let returnCount = 0;
  let safe = true;

  function visit(node: ts.Node): void {
    if (!safe) return;
    if (ts.isFunctionLike(node) && node !== fn) {
      safe = false;
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
      safe = false;
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const path = readAliasPath(node.initializer, aliases);
      if (path !== null) aliases.set(node.name.text, path);
    }
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const targetPath = readAliasPath(node.left, aliases);
      if (targetPath === null || !ALLOWED_TRANSPARENT_METADATA_PATHS.has(targetPath)) {
        safe = false;
        return;
      }
    }
    if (ts.isReturnStatement(node)) {
      returnCount += 1;
      const returnedPath = node.expression ? readAliasPath(node.expression, aliases) : null;
      if (returnedPath !== '') safe = false;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(fn.body);
  return safe && returnCount > 0;
}

function readAliasPath(node: ts.Node, aliases: Map<string, string>): string | null {
  const current = ts.isExpression(node) ? unwrapExpression(node) : node;
  if (ts.isIdentifier(current)) return aliases.get(current.text) ?? null;
  if (ts.isPropertyAccessExpression(current)) {
    const parent = readAliasPath(current.expression, aliases);
    if (parent === null) return null;
    return parent ? `${parent}.${current.name.text}` : current.name.text;
  }
  return null;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function unresolvedWrapper(node: ts.Node, wrapperName: string, context: ParseContext): ResolvedSchema {
  return {
    schema: {},
    required: true,
    diagnostics: [{
      ...diagnosticAt(
        context,
        node,
        'schema.wrapper_unresolved',
        `Wrapper ${wrapperName} is not a trusted import or statically proven transparent schema wrapper.`,
      ),
      wrapperName,
    }],
  };
}

function unresolvedReference(node: ts.Node, context: ParseContext, name?: string): ResolvedSchema {
  return {
    schema: {},
    required: true,
    diagnostics: [diagnosticAt(
      context,
      node,
      'schema.reference_unresolved',
      name ? `Static schema reference ${name} could not be resolved.` : 'Schema expression could not be resolved statically.',
    )],
  };
}

function diagnosticAt(
  context: ParseContext,
  node: ts.Node,
  code: PromptFrameSchemaDiagnosticCode,
  message: string,
): PromptFrameSchemaDiagnostic {
  const position = context.sourceFile.getLineAndCharacterOfPosition(node.getStart(context.sourceFile, false));
  return {
    code,
    message,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function resolved(
  schema: PromptFrameStaticSchemaNode,
  required = true,
  diagnostics: PromptFrameSchemaDiagnostic[] = [],
): ResolvedSchema {
  return { schema, required, diagnostics };
}

function readPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function readNumericLiteral(expression: ts.Expression): number | null {
  const value = readLiteralValue(expression);
  return typeof value === 'number' ? value : null;
}

function readJsonLiteralValue(expression: ts.Expression): unknown {
  const current = unwrapExpression(expression);
  const literal = readLiteralValue(current);
  if (literal !== undefined) return literal;
  if (ts.isArrayLiteralExpression(current)) {
    const values = current.elements.map((item) => readJsonLiteralValue(item as ts.Expression));
    return values.some((item) => item === undefined) ? undefined : values;
  }
  if (ts.isObjectLiteralExpression(current)) {
    const entries: Array<[string, unknown]> = [];
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const key = readPropertyName(property.name);
      const value = readJsonLiteralValue(property.initializer);
      if (!key || value === undefined) return undefined;
      entries.push([key, value]);
    }
    return Object.fromEntries(entries);
  }
  return undefined;
}

function readLiteralValue(expression: ts.Expression): unknown {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.MinusToken) {
    const value = readLiteralValue(current.operand);
    return typeof value === 'number' ? -value : undefined;
  }
  return undefined;
}

function schemaTypeForLiteral(value: unknown): Pick<PromptFrameStaticSchemaNode, 'type'> {
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return {};
}
