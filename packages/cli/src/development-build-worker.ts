import { posix } from 'node:path';
import ts from 'typescript';
import { build, version, type Plugin } from 'vite';
import { DevelopmentContents } from './development-revisions.js';
import { compileDevelopmentCssModule } from './development-css.js';

const prefix = '\0promptframe-captured:';
const entryPrefix = '\0promptframe-entry:';
const cssPrefix = '\0promptframe-css:';
const externals = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
  'react-dom', 'react-dom/client', 'remotion', 'zod', '@promptframe/component-kit', '@promptframe/contracts',
  '@promptframe/component-kit/layout', '@promptframe/component-kit/timing',
  '@promptframe/component-kit/style', '@promptframe/component-kit/standard']);
let diagnosticCode = 'development.build.failed';
function fail(code: string): never { diagnosticCode = code; throw new Error(code); }

async function main() {
  let total = 0;
  const input: Buffer[] = [];
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > 24 * 1024 * 1024) fail('development.build.input_limit');
    input.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(input).toString('utf8')) as {
    sourceRevision: string; files: Array<{ path: string; base64: string }>;
  };
  const captured = new DevelopmentContents(request.files.map(file => ({
    path: file.path, bytes: Buffer.from(file.base64, 'base64'),
  })), { maximumFiles: 2048, maximumBytes: 16 * 1024 * 1024 });
  if (captured.revision !== request.sourceRevision || version !== '8.0.10') fail('development.build.input_mismatch');
  const files = new Map(captured.readFiles().map(file => [file.path, file.bytes]));
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) fail('development.build.manifest_missing');
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as {
    entry: { sourcePath: string; componentExport?: string; propsSchemaPath: string };
  };
  const entries = { component: manifest.entry.sourcePath, schema: manifest.entry.propsSchemaPath, index: 'src/index.ts' };
  const cssPlaceholder = `__PROMPTFRAME_CAPTURED_CSS_${captured.revision}__`;
  const styles = new Map<string, string>();
  // Normalize the manifest's real component export and both supported schema
  // spellings to the Player's existing three-entry identity contract. Original
  // index exports remain available; no second manifest authority is created.
  const generated = new Map([
    ['component', `import * as Source from ${JSON.stringify(prefix + entries.component)};
      import { Fragment, createElement } from 'react';
      const Component = Source[${JSON.stringify(manifest.entry.componentExport ?? 'default')}];
      export default function CapturedComponent(props) {
        return createElement(Fragment, null, createElement('style', null, ${JSON.stringify(cssPlaceholder)}), createElement(Component, props));
      }`],
    ['schema', `import * as Source from ${JSON.stringify(prefix + entries.schema)};
      export * from ${JSON.stringify(prefix + entries.schema)};
      export const PropsSchema = Source.PropsSchema ?? Source.propsSchema;`],
    ['index', `export * from ${JSON.stringify(prefix + entries.index)};
      export { default } from ${JSON.stringify(entryPrefix + 'component')};
      export { PropsSchema } from ${JSON.stringify(entryPrefix + 'schema')};`],
  ]);
  const importedRuntimes = new Set<string>();
  const source = (path: string) => {
    const bytes = files.get(path);
    if (!bytes) fail('development.build.uncaptured_import');
    if (!/\.(?:[cm]?[jt]sx?|json)$/u.test(path) && !path.endsWith('.module.css')) fail('development.build.unsupported_source_type');
    const text = Buffer.from(bytes).toString('utf8');
    if (!path.endsWith('.json') && !path.endsWith('.module.css')) {
      const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        // These Vite features would discover files outside the closed import
        // graph. They need an explicit captured-resource contract first.
        if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
          fail('development.build.import_meta_unsupported');
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          && (node.arguments.length !== 1 || !(ts.isStringLiteral(node.arguments[0]!) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]!)))) {
          fail('development.build.dynamic_import_unsupported');
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    return text;
  };
  const plugin: Plugin = {
    name: 'promptframe-captured-sources', enforce: 'pre',
    resolveId(id, importer) {
      if (id.startsWith(entryPrefix)) {
        if (importer && !importer.startsWith(entryPrefix)) return fail('development.build.uncaptured_import');
        if (!generated.has(id.slice(entryPrefix.length))) return fail('development.build.uncaptured_import');
        return id;
      }
      if (id.startsWith(prefix)) {
        if (!importer?.startsWith(entryPrefix)) return fail('development.build.uncaptured_import');
        source(id.slice(prefix.length)); return id;
      }
      if (!importer?.startsWith(prefix) && !importer?.startsWith(entryPrefix)) return fail('development.build.uncaptured_import');
      if (externals.has(id)) { importedRuntimes.add(id); return { id, external: true }; }
      if (!importer.startsWith(prefix)) return fail('development.build.uncaptured_import');
      if (!id.startsWith('.') || /[\\?#\0]/u.test(id)) return fail('development.build.unsupported_dependency');
      const path = posix.normalize(posix.join(posix.dirname(importer.slice(prefix.length)), id));
      if (path === '..' || path.startsWith('../') || posix.isAbsolute(path)) return fail('development.build.uncaptured_import');
      const resolved = [path, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.json', '/index.ts', '/index.tsx', '/index.js'].map(ext => path + ext)]
        .find(candidate => files.has(candidate));
      if (!resolved) return fail('development.build.uncaptured_import');
      source(resolved);
      // This loader already compiled the CSS Module to JS. A JS virtual ID
      // keeps Vite's later CSS plugin from parsing that mapping as a stylesheet.
      return resolved.endsWith('.module.css') ? cssPrefix + resolved + '.mjs' : prefix + resolved;
    },
    async load(id) {
      if (id.startsWith(entryPrefix)) return generated.get(id.slice(entryPrefix.length))!;
      if (!id.startsWith(prefix) && !id.startsWith(cssPrefix)) return fail('development.build.uncaptured_import');
      const path = id.startsWith(cssPrefix) ? id.slice(cssPrefix.length, -4) : id.slice(prefix.length), text = source(path);
      if (path.endsWith('.module.css')) {
        let compiled;
        try { compiled = await compileDevelopmentCssModule({ path, text, sourceRevision: captured.revision }); }
        catch { return fail('development.build.unsupported_css'); }
        styles.set(path, compiled.css);
        return `export default ${JSON.stringify(compiled.classes)};`;
      }
      return text;
    },
  };
  const result = await build({ root: process.cwd(), configFile: false, envFile: false,
    mode: 'development', publicDir: false, logLevel: 'silent', plugins: [plugin],
    css: { postcss: { plugins: [] } }, resolve: { tsconfigPaths: false },
    oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
    build: { write: false, target: 'es2022', minify: false, sourcemap: false, modulePreload: false,
      lib: { entry: Object.fromEntries(Object.keys(entries).map(key => [key, entryPrefix + key])), formats: ['es'] },
      rolldownOptions: { input: Object.fromEntries(Object.keys(entries).map(key => [key, entryPrefix + key])),
        output: { entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs',
        assetFileNames: 'assets/[name]-[hash][extname]' } },
    },
  });
  const built = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (!built || !('output' in built)) fail('development.build.invalid_output');
  const css = [...styles].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, text]) => text).join('\n');
  let replacements = 0;
  const output = built.output.map(file => {
    if (file.type !== 'chunk') return { path: file.fileName, bytes: Buffer.from(file.source) };
    const code = file.code.replaceAll(JSON.stringify(cssPlaceholder), () => { replacements++; return JSON.stringify(css); });
    return { path: file.fileName, bytes: Buffer.from(code) };
  });
  if (replacements !== 1) fail('development.build.invalid_output');
  output.push({ path: 'manifest.json', bytes: Buffer.from(manifestBytes) });
  for (const [path, bytes] of files) {
    if (path.startsWith('public/')) output.push({ path: 'resources/public/' + path.slice(7), bytes: Buffer.from(bytes) });
    if (path === 'src/preview-props.json') output.push({ path: 'preview.json', bytes: Buffer.from(bytes) });
  }
  const artifacts = new DevelopmentContents(output, { maximumFiles: 512, maximumBytes: 8 * 1024 * 1024 });
  process.stdout.write(JSON.stringify({ sourceRevision: captured.revision, builder: `vite/${version}/captured-v1`,
    entries: Object.fromEntries(Object.keys(entries).map(key => [key, `${key}.mjs`])),
    runtimeImports: [...importedRuntimes].sort(),
    files: artifacts.readFiles().map(file => ({ path: file.path, base64: Buffer.from(file.bytes).toString('base64') })),
  }));
}

try { await main(); }
catch { process.stderr.write(JSON.stringify({ code: diagnosticCode })); process.exitCode = 1; }
