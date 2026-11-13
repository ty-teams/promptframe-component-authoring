import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePromptFrameLayoutPolicy as legacyLayout, LAYOUT_CAPABILITY_VERSION } from '../dist/index.js';
import { evaluatePromptFrameLayoutPolicy } from '../dist/layout-policy-evaluator.js';

const manifest = { layout: { contractVersion: LAYOUT_CAPABILITY_VERSION, layoutMode: 'slot_fill_reflow', recommendedSlot: 'card',
  minReadableSize: { width: 320, height: 180 }, supportedAspectRatios: ['16:9'], layoutAdaptivity: 'responsive',
  overflowPolicy: 'fit', safeAreaPolicy: 'recommended', confidence: 0.8 } };
const evaluate = (componentSourceText, files = []) => evaluatePromptFrameLayoutPolicy({ manifest, componentSourceText, files });
const codes = value => value.diagnostics.map(row => row.code);

test('AST layout keeps zero, unitless line height and SVG/data coordinates out of pixel violations', () => {
  const source = `const geometry = { width: 640, height: 360, left: 24 };
export default function Component() { return <div style={{padding: 0, margin: 0, lineHeight: 1.2}}>
  <svg viewBox="0 0 640 360"><rect {...geometry} x={0} y={20}/></svg></div>; }`;
  assert.equal(legacyLayout({ manifest, componentSourceText: source }).accepted, false, 'the original literal scanner reproduces the reported false positive');
  assert.equal(evaluate(source).accepted, true);
});

test('AST layout reads actual style references through imports and lexical shadowing', () => {
  const shadow = `const style={padding: 400};export default function Component(){const style={padding:0};return <div style={style}/>}`;
  assert.equal(evaluate(shadow).accepted, true);
  const result = evaluate(`import { style } from './styles.js';export default function Component(){return <div style={style}/>}`, [
    { path: 'src/styles.ts', sourceText: '\nexport const style = {padding: 64};' },
  ]);
  assert.equal(result.accepted, false);
  assert.match(result.diagnostics[0].message, /src\/styles\.ts:2:\d+/);
});

test('a scaled sibling or hairline no longer masks an unscaled layout property', () => {
  const source = 'export default function Component(){return <div style={{padding:layout.px(40), gap:64, border:"1px solid red"}}/>}';
  assert.equal(legacyLayout({ manifest, componentSourceText: source }).accepted, true, 'old line-wide exception is the negative control');
  const result = evaluate(source);
  assert(codes(result).includes('component.layout.naked_px_high_risk'));
  assert.match(result.diagnostics[0].message, /src\/Component\.tsx:1:\d+: gap/);
});

test('fixed axes and viewport escape still reject, while static zero overrides are effective', () => {
  const bad = evaluate('export default ()=> <div style={{width:1280,height:720,minWidth:"100vw"}}/>');
  assert(codes(bad).includes('component.layout.root_fixed_size'));
  assert(codes(bad).includes('component.layout.root_viewport_unit'));
  assert.equal(evaluate('const base={width:500};export default ()=> <div style={{...base,width:0,height:0}}/>').accepted, true);
  assert.equal(evaluate('export default ()=> <div style={{width:"100%",height:"100%",lineHeight:"1.2",padding:layout.px(40)}}/>').accepted, true);
});

test('factory styles, createElement aliases and typed CSS properties retain enforcement', () => {
  for (const source of [
    'function style(){return {padding:72}};export default ()=> <div style={style()}/>;',
    'import {createElement as h} from "react";export default ()=>h("div",{"style":{padding:72}});',
    'const style:React.CSSProperties={padding:72};export default ()=> <div/>;',
    'export default ()=> <div style={{left:-(24 as number)}}/>;',
  ]) assert(codes(evaluate(source)).includes('component.layout.naked_px_high_risk'), source);
});

test('CSS zero and comments are harmless; positive pixel lengths and explicit pixel line height remain errors', () => {
  const css = sourceText => evaluate('export default ()=> <div/>', [{ path: 'src/Component.module.css', sourceText }]);
  assert.equal(css('/* width:100vw; animation: spin 1s; */\n.root {padding:0px;line-height:1.2;border:1px solid red;stroke-width:2px}').accepted, true);
  for (const value of ['padding:64px', 'margin:0 -24px', 'line-height:24px', 'width:calc(100% - 32px)']) {
    const result = css('\n.root {' + value + '}');
    assert(codes(result).includes('component.layout.naked_px_high_risk'), value);
    assert.match(result.diagnostics[0].message, /src\/Component\.module\.css:2:/);
  }
});

test('unresolved source syntax cannot produce a green layout report', () => {
  const result = evaluate('export default ()=> <div style={{padding: />');
  assert.equal(result.accepted, false);
  assert(codes(result).includes('component.layout.source_parse_unresolved'));
});

test('declared runtime entry never inherits a preview/test filename exemption or another file snapshot', () => {
  const componentSourceText = 'export default ()=> <div style={{padding:72}}/>;';
  const result = evaluatePromptFrameLayoutPolicy({ manifest: { ...manifest, entry: { sourcePath: 'src/PreviewRoot.tsx' } }, componentSourceText });
  assert.equal(result.accepted, false);
  assert.match(result.diagnostics[0].message, /src\/PreviewRoot\.tsx:1:/);
  const conflict = evaluate(componentSourceText, [{ path: 'src/Component.tsx', sourceText: 'export default ()=> <div/>;' }]);
  assert.equal(conflict.accepted, false);
  assert(codes(conflict).includes('component.layout.source_parse_unresolved'));
});

test('one safe conditional branch cannot erase an unsafe style or literal branch', () => {
  for (const source of [
    'const style=enabled?{padding:72}:{padding:0};export default ()=> <div style={style}/>;',
    'const base=enabled?{padding:72}:{padding:0};export default ()=> <div style={{...base,margin:0}}/>;',
    'const space=72;export default ()=> <div style={{padding:space}}/>;',
    'const padding=72;export default ()=> <div style={{padding}}/>;',
    'export default ()=> <div style={{padding:enabled?72:0}}/>;',
    'function style(){if(enabled)return {padding:72};return {padding:0}};export default ()=> <div style={style()}/>;',
  ]) assert(codes(evaluate(source)).includes('component.layout.naked_px_high_risk'), source);
  assert.equal(evaluate('const base=enabled?{padding:72}:{padding:0};export default ()=> <div style={{...base,padding:0}}/>;').accepted, true);
});

test('runtime-reachable component JSX cannot use a support filename to bypass layout checks', () => {
  const result = evaluate('import Child from "./child.test";export default ()=> <Child/>;', [
    {path:'src/child.test.tsx',sourceText:'export default ()=> <div style={{padding:72}}/>;'},
  ]);
  assert(codes(result).includes('component.layout.naked_px_high_risk'));
  assert.match(result.diagnostics[0].message,/child\.test\.tsx:1:/);
});

test('JSX props spreads inspect the effective style through static props and imports', () => {
  for (const source of [
    'export default ()=> <div {...{style:{padding:72,width:1280,height:720}}}/>;',
    'const props={style:{padding:72}};export default ()=> <div {...props}/>;',
    'const props=enabled?{style:{padding:72}}:{style:{padding:0}};export default ()=> <div {...props}/>;',
    'const first={style:{padding:0}};const last={style:{padding:72}};export default ()=> <div {...first} {...last}/>;',
    'export default ()=> <div style={{padding:0}} {...{style:{padding:72}}}/>;',
  ]) assert(codes(evaluate(source)).includes('component.layout.naked_px_high_risk'), source);
  const imported = evaluate('import {props} from "./props";export default ()=> <div {...props}/>;', [
    {path:'src/props.ts',sourceText:'export const props={style:{padding:72}};'},
  ]);
  assert.match(imported.diagnostics[0].message,/src\/props\.ts:1:/);
  assert(codes(evaluate('export default ()=> <div {...{style:{width:1280,height:720}}}/>;')).includes('component.layout.root_fixed_size'));
});

test('JSX props overrides and non-style geometry preserve the effective safe result', () => {
  for (const source of [
    'const bad={style:{padding:72}};export default ()=> <div {...bad} style={{padding:0,lineHeight:1.2}}/>;',
    'export default ()=> <div style={{padding:72}} {...{style:{padding:0}}}/>;',
    'const bad={style:{padding:72}};export default ()=> <div {...bad} {...{style:{padding:0}}}/>;',
    'const props={width:640,height:360,style:{padding:0,lineHeight:1.2}};export default ()=> <svg><rect {...props}/></svg>;',
    'const props={style:{padding:layout.px(40),width:"100%",height:"100%"}};export default ()=> <div {...props}/>;',
  ]) assert.equal(evaluate(source).accepted,true,source);
});

test('a bounded JSX props analysis cannot report success after exceeding its branch budget', () => {
  const spreads=Array.from({length:7},(_,i)=>`{...(choice${i}?{style:{padding:0}}:{style:{padding:0}})}`).join(' ');
  assert(codes(evaluate(`export default ()=> <div ${spreads}/>;`)).includes('component.layout.source_parse_unresolved'));
});
