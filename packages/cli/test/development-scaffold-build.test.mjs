import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { DevelopmentContents } from '../dist/development-revisions.js';
import { captureDevelopmentFiles } from '../dist/development-files.js';
import { validateDevelopmentContents } from '../dist/development-validation.js';
import { buildDevelopmentContents } from '../dist/development-build.js';
import { developmentFixture, developmentLimits } from './fixtures/development-component.mjs';

async function scaffold(root, moduleId = '@demo/captured-component') {
  const paths = await developmentFixture(root);
  for (const name of ['src/Component.tsx', 'src/Component.module.css', 'src/schema.ts', 'src/index.ts',
    'src/preview-props.json', 'public/sample-data.json']) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), await readFile(new URL(`../../create-component/templates/react-remotion/${name}`, import.meta.url)));
    if (!paths.includes(name)) paths.push(name);
  }
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.id = moduleId;
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return captureDevelopmentFiles(root, paths, developmentLimits);
}

const javascript = built => built.artifacts.readFiles().filter(file => file.path.endsWith('.mjs'))
  .map(file => Buffer.from(file.bytes).toString()).join('\n');

test('declared frame actions survive captured validation/build and cannot select text or missing props', async () => {
  const root=await mkdtemp(join(tmpdir(),'pf-action-slot-build-'));
  try {
    const initial=await scaffold(root),paths=initial.readFiles().map(file=>file.path);
    const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
    manifest.actionSlots=[{name:'emphasize',description:'开始强调的节点局部帧',propPath:['emphasisFrame'],unit:'frame',timeBase:'node'}];
    const schema=await readFile(join(root,'src/schema.ts'),'utf8');
    await writeFile(join(root,'src/schema.ts'),schema.replace('kicker:',"emphasisFrame: z.number().int().min(0).describe('开始强调的节点局部帧').default(0),\n  kicker:"));
    await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
    const captured=captureDevelopmentFiles(root,paths,developmentLimits);
    await validateDevelopmentContents(captured);
    const built=await buildDevelopmentContents(captured);
    assert.deepEqual(JSON.parse(Buffer.from(built.artifacts.readFiles().find(file=>file.path==='manifest.json').bytes).toString()).actionSlots,manifest.actionSlots);
    for(const propPath of [['title'],['missing']]){
      manifest.actionSlots[0].propPath=propPath;
      await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(validateDevelopmentContents(captureDevelopmentFiles(root,paths,developmentLimits)),
        error=>error.diagnosticCode==='component.action_slot.numeric_property_required');
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a checked optional content declaration survives the real development capture and build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-content-slot-build-'));
  try {
    const source = join(root, 'source'), initial = await scaffold(source);
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
    manifest.contentSlots = [{ name: 'description', description: 'Explanation', maxChildren: 2 }];
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
    const captured = captureDevelopmentFiles(source, initial.readFiles().map(file => file.path), developmentLimits);
    await validateDevelopmentContents(captured);
    const built = await buildDevelopmentContents(captured);
    const manifestFile = built.artifacts.readFiles().find(file => file.path === 'manifest.json');
    assert.deepEqual(JSON.parse(Buffer.from(manifestFile.bytes).toString()).contentSlots, manifest.contentSlots);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the actual scaffold TSX, CSS Modules, lower-case schema and named index build from their checked capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-default-scaffold-build-'));
  try {
    const captured = await scaffold(join(root, 'source'));
    await validateDevelopmentContents(captured);
    const built = await buildDevelopmentContents(captured);
    const code = javascript(built);
    assert.match(code, /pf_[a-f0-9]{20}_root/);
    assert.match(code, /justify-content: center/);
    assert.match(code, /font-size: var\(--pf-title-size\)/);
    assert.doesNotMatch(code, /__PROMPTFRAME_CAPTURED_CSS_/);
    assert.equal(built.artifacts.readFiles().some(file => file.path.endsWith('.css')), false);
    assert.equal((await buildDevelopmentContents(captured)).artifacts.revision, built.artifacts.revision);
    const sibling = await scaffold(join(root, 'sibling'), '@demo/sibling-component');
    const siblingCode = javascript(await buildDevelopmentContents(sibling));
    assert.notEqual(code.match(/pf_[a-f0-9]{20}_root/)[0], siblingCode.match(/pf_[a-f0-9]{20}_root/)[0]);
    // Evaluate the emitted three-entry ABI. These small runtime ports do not
    // claim a rendered Player; the scaffold schema/index and real Vite graph
    // are unchanged. The browser consumer separately verifies actual rendering.
    const output = join(root, 'output');
    for (const file of built.artifacts.readFiles()) {
      await mkdir(dirname(join(output, file.path)), { recursive: true });
      await writeFile(join(output, file.path), file.bytes);
    }
    const runtime = async (name, code, exports = './index.js') => {
      const directory = join(output, 'node_modules', name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', exports }));
      await writeFile(join(directory, 'index.js'), code);
    };
    await runtime('react', 'export const Fragment = Symbol("fragment"); export const createElement = (type, props, ...children) => ({type,props,children});',
      { '.': './index.js', './jsx-runtime': './jsx-runtime.js' });
    await writeFile(join(output, 'node_modules/react/jsx-runtime.js'), 'export const jsx = () => {}; export const jsxs = jsx;');
    await runtime('remotion', 'export const AbsoluteFill=()=>{}; export const interpolate=()=>0; export const useCurrentFrame=()=>0; export const useVideoConfig=()=>({});');
    await runtime('@promptframe/component-kit', 'export const promptFramePublicResource=()=>""; export const createPromptFrameLayout=()=>({px:x=>x});', { '.': './index.js', './layout': './index.js' });
    await runtime('zod', 'const field={describe(){return this},default(){return this}}; export const z={string:()=>({...field}),object:()=>({parse:value=>value})};');
    const [component, schema, index] = await Promise.all(['component', 'schema', 'index']
      .map(name => import(pathToFileURL(join(output, built.entries[name])).href)));
    assert.equal(typeof component.default, 'function');
    assert.equal(typeof schema.PropsSchema.parse, 'function');
    assert.equal(schema.PropsSchema, schema.propsSchema);
    assert.equal(index.default, component.default);
    assert.equal(index.PropsSchema, schema.PropsSchema);
    assert.equal(typeof index.Component, 'function', 'The original named index export is retained.');
    const tree = component.default({ title: 'actual scaffold' });
    assert.equal(tree.children[0].type, 'style');
    assert.match(tree.children[0].children[0], /pf_[a-f0-9]{20}_root/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('captured CSS Modules cannot resolve ambient resources or select another module', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pf-scaffold-css-closed-'));
  try {
    const captured = await scaffold(root);
    for (const css of [
      '@import "./ambient.css"; .root {color:red}',
      '.root {background:url(https://foreign.example/mark.png)}',
      '.root {composes: other from "./ambient.module.css"}',
      ':global(body) {color:red}', '.root + .other {color:red}',
      '.root {background: u\\72l(https://foreign.example/mark.png)}',
      '.root {color:red} /*# sourceMappingURL=../ambient.map */',
    ]) {
      const files = captured.readFiles();
      files.find(file => file.path === 'src/Component.module.css').bytes = Buffer.from(css);
      await assert.rejects(buildDevelopmentContents(new DevelopmentContents(files, developmentLimits)), error => {
        assert.equal(error.code, 'development.build.rejected');
        assert.equal(error.diagnosticCode, 'development.build.unsupported_css');
        return true;
      });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
